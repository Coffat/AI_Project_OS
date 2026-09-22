// Architectural boundary violation: Model layer importing API layer!
import { UserRouter } from '../api/user-router.js';

export interface UserModel {
  id: string;
  name: string;
  routerRef?: UserRouter;
}
