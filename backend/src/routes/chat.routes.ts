import { Router } from 'express';
import * as chatController from '../controllers/chat.controller';

const router = Router();

router.post('/', chatController.chat);
router.post('/stream', chatController.chatStream);

export default router;