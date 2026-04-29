var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, Injectable } from '@nestjs/common';
let ZodValidationPipe = class ZodValidationPipe {
    schema;
    errorCode;
    constructor(schema, errorCode) {
        this.schema = schema;
        this.errorCode = errorCode;
    }
    transform(value) {
        const parsed = this.schema.safeParse(value);
        if (!parsed.success)
            throw new BadRequestException(this.errorCode);
        return parsed.data;
    }
};
ZodValidationPipe = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Function, String])
], ZodValidationPipe);
export { ZodValidationPipe };
