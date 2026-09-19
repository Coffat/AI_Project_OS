import { UserService } from '../services/user-service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (...args: any[]) => any;

const router = {
  get: (_path: string, _handler: RouteHandler) => {},
  post: (_path: string, _handler: RouteHandler) => {},
};

const userService = new UserService();

// Router endpoint for fetching user profile
router.get('/api/users/:id', (req: { params: { id: string } }) => {
  return userService.getUser(req.params.id);
});

export { router };
