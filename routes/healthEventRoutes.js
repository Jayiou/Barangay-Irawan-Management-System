const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const controller = require('../controllers/healthEventController');

// Admin-only: create/update events
router.post('/', authMiddleware, roleMiddleware('admin'), controller.createEvent);
router.get('/', authMiddleware, controller.listEvents);
router.get('/:id', authMiddleware, controller.getEvent);
router.put('/:id', authMiddleware, roleMiddleware('admin'), controller.updateEvent);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), controller.deleteEvent);
router.post('/:id/toggle-queue', authMiddleware, roleMiddleware('admin', 'bhw'), controller.toggleQueue);

module.exports = router;
