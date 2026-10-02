import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { OpportunitiesModule } from "./opportunities/opportunities.module";
import { InterpretationModule } from "./interpretation/interpretation.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { ReevaluationWorkerModule } from "./reevaluation/reevaluation-worker.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IngestionModule,
    WhatsappModule,
    OpportunitiesModule,
    InterpretationModule,
    KnowledgeModule,
    ReevaluationWorkerModule,
  ],
})
export class AppModule {}
