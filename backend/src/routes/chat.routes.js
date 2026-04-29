const { Router } = require('express');
const chatController = require('../controllers/chat.controller');

const router = Router();
router.post('/', chatController.chat);
router.post('/stream', chatController.chatStream);
router.post('/title', chatController.generateTitle);

module.exports = router;
