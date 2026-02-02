import { Router } from 'express';
import authRoutes from './auth.routes';
import todoRoutes from './todo.routes';
import chatRoutes from './chat.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/todos', todoRoutes);
router.use('/chat', chatRoutes);

export default router;