import { UserDto } from '../dto/user.dto';

export interface IUserService {
  getProfile(_id: string): Promise<UserDto>;
}
