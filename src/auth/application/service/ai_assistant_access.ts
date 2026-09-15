export interface AiAssistantAccess {
  canConnect(userId: string): Promise<boolean>;
}
