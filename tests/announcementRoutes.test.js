const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../app');
const User = require('../models/User');
const Announcement = require('../models/Announcement');
const Resident = require('../models/Resident');

const originalFindById = User.findById;
const originalFind = Announcement.find;
const originalAnnouncementFindById = Announcement.findById;
const originalAnnouncementFindByIdAndDelete = Announcement.findByIdAndDelete;
const originalAnnouncementFindByIdAndUpdate = Announcement.findByIdAndUpdate;
const originalAnnouncementGetNextDisplayOrder = Announcement.getNextDisplayOrder;
const originalAnnouncementSave = Announcement.prototype.save;
const originalAnnouncementPopulate = Announcement.prototype.populate;
const originalResidentFind = Resident.find;
const originalJwtVerify = jwt.verify;

const startServer = () => {
    const server = app.listen(0);
    const { port } = server.address();

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
};

const tokenFor = (id, role) => `${id}:${role}`;

const stubUserRole = (role) => {
    jwt.verify = (token) => {
        const [id, decodedRole] = String(token).split(':');
        return {
            id: id || `${role}-user`,
            role: decodedRole || role
        };
    };

    User.findById = () => ({
        select: async () => ({
            _id: `${role}-user`,
            role,
            isActive: true
        })
    });
};

test.afterEach(() => {
    User.findById = originalFindById;
    Announcement.find = originalFind;
    Announcement.findById = originalAnnouncementFindById;
    Announcement.findByIdAndDelete = originalAnnouncementFindByIdAndDelete;
    Announcement.findByIdAndUpdate = originalAnnouncementFindByIdAndUpdate;
    Announcement.getNextDisplayOrder = originalAnnouncementGetNextDisplayOrder;
    Announcement.prototype.save = originalAnnouncementSave;
    Announcement.prototype.populate = originalAnnouncementPopulate;
    Resident.find = originalResidentFind;
    jwt.verify = originalJwtVerify;
});

test('announcement write routes reject authenticated residents', async () => {
    stubUserRole('resident');

    const server = startServer();
    const token = tokenFor('resident-user', 'resident');
    const requestOptions = {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const responses = await Promise.all([
            fetch(`${server.baseUrl}/api/announcements`, {
                ...requestOptions,
                method: 'POST',
                body: JSON.stringify({
                    title: 'Resident post',
                    description: 'Should be blocked',
                    startDate: '2026-04-29'
                })
            }),
            fetch(`${server.baseUrl}/api/announcements/announcement-1`, {
                ...requestOptions,
                method: 'PUT',
                body: JSON.stringify({ title: 'Resident edit' })
            }),
            fetch(`${server.baseUrl}/api/announcements/announcement-1`, {
                ...requestOptions,
                method: 'DELETE'
            }),
            fetch(`${server.baseUrl}/api/announcements/admin/reorder`, {
                ...requestOptions,
                method: 'POST',
                body: JSON.stringify({
                    announcements: [{ id: 'announcement-1', displayOrder: 1 }]
                })
            })
        ]);

        assert.deepEqual(responses.map((response) => response.status), [403, 403, 403, 403]);
    } finally {
        await server.close();
    }
});

test('public announcement listing only returns currently live active announcements', async () => {
    const server = startServer();
    let queryFilter = null;
    let sortFilter = null;
    let selectFilter = null;
    const liveAnnouncements = [
        {
            _id: 'announcement-1',
            title: 'Live Advisory',
            description: 'Shown on portal',
            isActive: true,
            startDate: new Date('2026-05-01T08:00:00.000Z'),
            endDate: null,
            displayOrder: 1
        }
    ];

    Announcement.find = (query) => {
        queryFilter = query;
        return {
            sort: (sort) => {
                sortFilter = sort;
                return {
                    select: async (select) => {
                        selectFilter = select;
                        return liveAnnouncements;
                    }
                };
            }
        };
    };

    try {
        const response = await fetch(`${server.baseUrl}/api/announcements`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.length, 1);
        assert.equal(body.data[0].title, 'Live Advisory');
        assert.equal(queryFilter.isActive, true);
        assert.ok(queryFilter.startDate.$lte instanceof Date);
        assert.deepEqual(sortFilter, { displayOrder: 1, createdAt: -1 });
        assert.equal(selectFilter, '-createdBy');
    } finally {
        await server.close();
    }
});

test('announcement admin listing rejects residents and allows admins', async () => {
    const server = startServer();

    try {
        stubUserRole('resident');

        const residentResponse = await fetch(`${server.baseUrl}/api/announcements/admin/all`, {
            headers: { Authorization: `Bearer ${tokenFor('resident-user', 'resident')}` }
        });

        assert.equal(residentResponse.status, 403);

        stubUserRole('admin');
        Announcement.find = () => ({
            populate: () => ({
                sort: async () => []
            })
        });

        const adminResponse = await fetch(`${server.baseUrl}/api/announcements/admin/all`, {
            headers: { Authorization: `Bearer ${tokenFor('admin-user', 'admin')}` }
        });
        const body = await adminResponse.json();

        assert.equal(adminResponse.status, 200);
        assert.deepEqual(body, { success: true, data: [] });
    } finally {
        await server.close();
    }
});

test('announcement create route rejects end date earlier than start date', async () => {
    stubUserRole('admin');

    const server = startServer();

    try {
        const response = await fetch(`${server.baseUrl}/api/announcements`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenFor('admin-user', 'admin')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Invalid Announcement',
                description: 'End date is before start date',
                startDate: '2026-05-20T12:00',
                endDate: '2026-05-01T12:00'
            })
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(body.message, 'End date cannot be earlier than start date');
    } finally {
        await server.close();
    }
});

test('announcement update route saves start date and end date separately', async () => {
    stubUserRole('admin');

    const server = startServer();
    const existingAnnouncement = {
        _id: 'announcement-1',
        title: 'Barangay Advisory',
        description: 'Old description',
        displayOrder: 2,
        startDate: new Date('2026-05-08T12:00:00.000Z'),
        endDate: new Date('2026-05-15T12:00:00.000Z'),
        isActive: true,
        imagePath: '/uploads/old.png',
        save: async function save() {
            return this;
        },
        populate: async function populate() {
            return this;
        }
    };

    Announcement.findById = async () => existingAnnouncement;

    try {
        const formData = new FormData();
        formData.append('title', 'Barangay Advisory');
        formData.append('description', 'Updated description');
        formData.append('startDate', '2026-05-01T12:00');
        formData.append('endDate', '2026-05-20T12:00');
        formData.append('displayOrder', '2');
        formData.append('isActive', 'true');

        const response = await fetch(`${server.baseUrl}/api/announcements/announcement-1`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${tokenFor('admin-user', 'admin')}` },
            body: formData
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(existingAnnouncement.description, 'Updated description');
        assert.equal(existingAnnouncement.startDate.toISOString().slice(0, 10), '2026-05-01');
        assert.equal(existingAnnouncement.endDate.toISOString().slice(0, 10), '2026-05-20');
    } finally {
        await server.close();
    }
});

test('announcement create route auto-assigns the next display order after 10', async () => {
    stubUserRole('admin');

    const server = startServer();
    const originalSave = Announcement.prototype.save;
    const originalPopulate = Announcement.prototype.populate;
    let savedDisplayOrder = null;

    Announcement.getNextDisplayOrder = async () => 11;
    Announcement.prototype.save = async function save() {
        savedDisplayOrder = this.displayOrder;
        return this;
    };
    Announcement.prototype.populate = async function populate() {
        return this;
    };

    try {
        const response = await fetch(`${server.baseUrl}/api/announcements`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenFor('admin-user', 'admin')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'New Announcement',
                description: 'Should become order 11',
                startDate: '2026-05-01T12:00'
            })
        });
        const body = await response.json();

        assert.equal(response.status, 201);
        assert.equal(body.success, true);
        assert.equal(savedDisplayOrder, 11);
    } finally {
        Announcement.prototype.save = originalSave;
        Announcement.prototype.populate = originalPopulate;
        await server.close();
    }
});

test('important announcement notifies active approved residents by SMS', async () => {
    stubUserRole('admin');

    const server = startServer();
    let saveCount = 0;

    Announcement.getNextDisplayOrder = async () => 12;
    Announcement.prototype.save = async function save() {
        saveCount += 1;
        return this;
    };
    Announcement.prototype.populate = async function populate() {
        return this;
    };
    Resident.find = () => ({
        populate: () => ({
            lean: async () => [
                {
                    _id: 'resident-1',
                    contactNumber: '09171234567',
                    userId: { role: 'resident', isActive: true, accountStatus: 'approved' }
                },
                {
                    _id: 'resident-2',
                    contactNumber: '09181234567',
                    userId: { role: 'resident', isActive: true, accountStatus: 'pending_approval' }
                }
            ]
        })
    });

    try {
        const response = await fetch(`${server.baseUrl}/api/announcements`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenFor('admin-user', 'admin')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Water Interruption',
                description: 'Details are available on the website.',
                startDate: '2026-06-15T08:00',
                isImportant: true
            })
        });
        const body = await response.json();

        assert.equal(response.status, 201);
        assert.equal(body.data.isImportant, true);
        assert.equal(body.data.smsNotifiedResidentCount, 1);
        assert.ok(body.data.smsNotificationSentAt);
        assert.equal(saveCount, 2);
    } finally {
        await server.close();
    }
});
