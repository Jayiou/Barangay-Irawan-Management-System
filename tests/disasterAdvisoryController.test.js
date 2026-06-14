const test = require('node:test');
const assert = require('node:assert/strict');

const DisasterAdvisory = require('../models/DisasterAdvisory');
const Resident = require('../models/Resident');
const mailer = require('../utils/mailer');
const { createMockResponse } = require('./helpers/httpMocks');

const controllerPath = require.resolve('../controllers/disasterAdvisoryController');
const originals = {
    advisoryCreate: DisasterAdvisory.create,
    advisoryFindById: DisasterAdvisory.findById,
    residentFind: Resident.find,
    sendDisasterAdvisoryEmail: mailer.sendDisasterAdvisoryEmail
};

const loadController = () => {
    delete require.cache[controllerPath];
    return require('../controllers/disasterAdvisoryController');
};

const makeAdvisoryDocument = (payload) => ({
    _id: 'advisory-1',
    ...payload,
    saveCalled: false,
    toObject() {
        return { ...this };
    },
    async save() {
        this.saveCalled = true;
        return this;
    }
});

const stubAdvisoryStorage = () => {
    let savedAdvisory;

    DisasterAdvisory.create = async (payload) => {
        savedAdvisory = makeAdvisoryDocument(payload);
        return savedAdvisory;
    };

    DisasterAdvisory.findById = () => ({
        populate: async () => ({
            ...savedAdvisory,
            createdBy: { _id: 'admin-1', username: 'admin' },
            toObject() {
                return { ...this };
            }
        })
    });

    return () => savedAdvisory;
};

const stubResidentFind = (residents) => {
    Resident.find = () => ({
        populate: () => ({
            lean: async () => residents
        })
    });
};

test.afterEach(() => {
    DisasterAdvisory.create = originals.advisoryCreate;
    DisasterAdvisory.findById = originals.advisoryFindById;
    Resident.find = originals.residentFind;
    mailer.sendDisasterAdvisoryEmail = originals.sendDisasterAdvisoryEmail;
    delete require.cache[controllerPath];
});

test('createDisasterAdvisory stores optional image and notifies residents in selected Purok and Zone', async () => {
    const getSavedAdvisory = stubAdvisoryStorage();
    const sentEmails = [];
    mailer.sendDisasterAdvisoryEmail = async (email, name) => {
        sentEmails.push({ email, name });
    };
    stubResidentFind([
        {
            firstName: 'Ana',
            lastName: 'Santos',
            email: 'ana@example.com',
            purok: 'Sampalok',
            zone: 'Zone 2',
            userId: { role: 'resident', isActive: true }
        },
        {
            firstName: 'Ben',
            lastName: 'Reyes',
            email: 'ben@example.com',
            purok: 'Sampalok',
            zone: 'Zone 3',
            userId: { role: 'resident', isActive: true }
        }
    ]);

    const controller = loadController();
    const req = {
        user: { id: 'admin-1' },
        file: { filename: 'image-123.png' },
        body: {
            disasterType: 'flood',
            expectedImpactDate: '2026-05-29T10:00',
            severity: 'high',
            floodProneAreas: ['1. Sampalok - Zone 2'],
            evacuationCenters: ['Barangay Hall'],
            advisoryMessage: 'Prepare for possible flooding.',
            status: 'upcoming'
        }
    };
    const res = createMockResponse();

    await controller.createDisasterAdvisory(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.imagePath, '/uploads/image-123.png');
    assert.equal(res.body.notifiedResidentCount, 1);
    assert.equal(getSavedAdvisory().saveCalled, true);
    assert.deepEqual(sentEmails, [{ email: 'ana@example.com', name: 'Ana Santos' }]);
});

test('createDisasterAdvisory does not notify residents outside the selected zone', async () => {
    stubAdvisoryStorage();
    const sentEmails = [];
    mailer.sendDisasterAdvisoryEmail = async (email) => {
        sentEmails.push(email);
    };
    stubResidentFind([
        {
            firstName: 'Ben',
            lastName: 'Reyes',
            email: 'ben@example.com',
            purok: 'Sampalok',
            zone: 'Zone 3',
            userId: { role: 'resident', isActive: true }
        }
    ]);

    const controller = loadController();
    const req = {
        user: { id: 'admin-1' },
        body: {
            disasterType: 'flood',
            expectedImpactDate: '2026-05-29T10:00',
            severity: 'high',
            floodProneAreas: ['1. Sampalok - Zone 2'],
            advisoryMessage: 'Prepare for possible flooding.',
            status: 'upcoming'
        }
    };
    const res = createMockResponse();

    await controller.createDisasterAdvisory(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notifiedResidentCount, 0);
    assert.deepEqual(sentEmails, []);
});

test('disaster advisory SMS uses disaster type instead of an undefined title', () => {
    const controller = loadController();
    const message = controller.buildDisasterAdvisorySmsMessage({
        disasterType: 'flood',
        severity: 'high',
        floodProneAreas: ['1. Sampalok - Zone 2'],
        evacuationCenters: ['Barangay Hall']
    });

    assert.match(message, /Brgy Irawan HIGH FLOOD ALERT/);
    assert.match(message, /1\. Sampalok - Zone 2/);
    assert.match(message, /Barangay Hall/);
    assert.doesNotMatch(message, /https?:\/\//);
    assert.doesNotMatch(message, /undefined/i);
    assert.ok(message.length <= 160);
});
