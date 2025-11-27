/**
 * Users API Routes
 */
import { Request, Response, Router } from 'express';
import { getUser, createUser } from '../db/connection';
import { generateToken, verifyToken, extractToken } from '../auth/jwt';

const router = Router();

// BUG: No rate limiting
router.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  // BUG: No input validation
  // BUG: No password strength check
  // BUG: No email format validation
  
  try {
    const user = await createUser(email, password);
    const token = generateToken({
      userId: user[0].id,
      email: user[0].email,
      role: 'user'
    });
    
    // BUG: Returns password in response
    res.json({ user: user[0], token });
  } catch (error: any) {
    // BUG: Exposes internal error details
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  // BUG: Timing attack vulnerability - different response times
  const users = await getUser(email);
  
  if (users.length === 0) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  // BUG: Plain text password comparison
  if (users[0].password !== password) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  const token = generateToken({
    userId: users[0].id,
    email: users[0].email,
    role: users[0].role
  });
  
  res.json({ token });
});

router.get('/profile', async (req: Request, res: Response) => {
  const token = extractToken(req.headers.authorization || '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  
  const payload = verifyToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  // BUG: SQL injection through userId from JWT
  const users = await getUser(payload.userId);
  
  // BUG: Returns sensitive data
  res.json(users[0]);
});

// BUG: No authorization check - any authenticated user can delete any user
router.delete('/:id', async (req: Request, res: Response) => {
  const token = extractToken(req.headers.authorization || '');
  const payload = verifyToken(token || '');
  
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // BUG: Mass assignment vulnerability - deletes without role check
  await getUser(`${req.params.id}' OR '1'='1`); // This would delete all!
  
  res.json({ deleted: true });
});

export default router;

