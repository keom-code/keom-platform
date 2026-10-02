import { Module } from "@nestjs/common";
import { DevBusinessReplyController } from "./dev-business-reply.controller";
import { IngestionService } from "./ingestion.service";

@Module({
  providers: [IngestionService],
  controllers: [DevBusinessReplyController],
  exports: [IngestionService],
})
export class IngestionModule {}
