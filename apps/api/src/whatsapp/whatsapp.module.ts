import { Module } from "@nestjs/common";
import { IngestionModule } from "../ingestion/ingestion.module";
import { WhatsappController } from "./whatsapp.controller";

@Module({
  imports: [IngestionModule],
  controllers: [WhatsappController],
})
export class WhatsappModule {}
