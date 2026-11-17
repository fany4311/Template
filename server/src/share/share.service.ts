import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class ShareService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ShareService.name);
  }
}
