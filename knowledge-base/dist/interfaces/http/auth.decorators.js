import { createParamDecorator } from '@nestjs/common';
export const CurrentUser = createParamDecorator((_data, context) => {
    const request = context.switchToHttp().getRequest();
    if (!request.user) {
        throw new Error('current_user_missing');
    }
    return request.user;
});
