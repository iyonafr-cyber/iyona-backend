import { forwardRef, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './entities/user.entity';
import { UserHelper } from './helper/user.helper';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => AuthModule),
  ],
  controllers: [UserController],
  providers: [
    UserService,
    {
      provide: 'IUserService',
      useClass: UserService,
    },
    {
      provide: 'IUserHelper',
      useClass: UserHelper,
    },
  ],

  exports: [
    {
      provide: 'IUserHelper',
      useClass: UserHelper,
    },
    {
      provide: 'IUserService',
      useClass: UserService,
    },
  ],
})
export class UserModule {}
