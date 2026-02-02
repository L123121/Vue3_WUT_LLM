export interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
  role: 'student' | 'teacher' | 'admin';
}