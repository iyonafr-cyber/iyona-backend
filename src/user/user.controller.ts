import { Body, Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { IUserService } from './interface/user.service.interface';
import { AuthGuard } from 'src/auth/guards/auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { UserRole } from './roles/roles.enum';
import { Roles } from 'src/auth/decorator/roles.decorator';
import { UserDto } from './dto/user.dto';

@Controller('user')
export class UserController {
  constructor(
    @Inject('IUserService') private readonly userService: IUserService,
  ) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Get('')
  async getProfile(@Req() request: Request): Promise<{ data: UserDto }> {
    const fullUser: UserDto = request['fullUser'];
    const user = await this.userService.getProfile(fullUser._id);
    return { data: user };
  }
}
