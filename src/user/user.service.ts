import { Injectable, Inject } from '@nestjs/common';
import { IUserService } from './interface/user.service.interface';
import { UserDto } from './dto/user.dto';
import type { IUserHelper } from './interface/user.helper.interface';
import { logAndThrowError } from 'src/utils/error.utils';

@Injectable()
export class UserService implements IUserService {
  constructor(
    @Inject('IUserHelper') private readonly userHelper: IUserHelper,
  ) {}

  async getProfile(_id: string): Promise<UserDto> {
    try {
      const [user] = await this.userHelper.findUser({ _id });
      return user;
    } catch (error) {
      throw logAndThrowError('error in getProfile', error);
    }
  }
}
