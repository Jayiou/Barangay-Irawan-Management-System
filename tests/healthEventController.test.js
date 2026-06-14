const test = require('node:test');
const assert = require('node:assert/strict');

const HealthEvent = require('../models/HealthEvent');
const HealthQueue = require('../models/HealthQueue');
const controller = require('../controllers/healthEventController');
const { createMockResponse } = require('./helpers/httpMocks');

const originals = {
    eventFindById: HealthEvent.findById,
    queueCountDocuments: HealthQueue.countDocuments
};

test.afterEach(() => {
    HealthEvent.findById = originals.eventFindById;
    HealthQueue.countDocuments = originals.queueCountDocuments;
});

test('deleteEvent removes a scheduled event without queue records', async () => {
    let deleted = false;
    HealthEvent.findById = async () => ({
        _id: 'event-1',
        async deleteOne() {
            deleted = true;
        }
    });
    HealthQueue.countDocuments = async () => 0;

    const res = createMockResponse();
    await controller.deleteEvent({ params: { id: 'event-1' } }, res);

    assert.equal(deleted, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, message: 'Health event deleted' });
});

test('deleteEvent preserves an event that already has queue records', async () => {
    let deleted = false;
    HealthEvent.findById = async () => ({
        _id: 'event-1',
        async deleteOne() {
            deleted = true;
        }
    });
    HealthQueue.countDocuments = async () => 2;

    const res = createMockResponse();
    await controller.deleteEvent({ params: { id: 'event-1' } }, res);

    assert.equal(deleted, false);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /queue records/i);
});
