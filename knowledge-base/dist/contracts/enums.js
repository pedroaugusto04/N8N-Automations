export var SourceChannel;
(function (SourceChannel) {
    SourceChannel["Whatsapp"] = "whatsapp";
    SourceChannel["GithubPush"] = "github-push";
    SourceChannel["N8nWorkflow"] = "n8n-workflow";
    SourceChannel["External"] = "external";
})(SourceChannel || (SourceChannel = {}));
export var EventType;
(function (EventType) {
    EventType["ManualNote"] = "manual_note";
    EventType["CodeReview"] = "code_review";
    EventType["DailySummary"] = "daily_summary";
    EventType["GenericRecord"] = "generic_record";
})(EventType || (EventType = {}));
export var KnowledgeKind;
(function (KnowledgeKind) {
    KnowledgeKind["Note"] = "note";
    KnowledgeKind["Bug"] = "bug";
    KnowledgeKind["Summary"] = "summary";
    KnowledgeKind["Article"] = "article";
    KnowledgeKind["Daily"] = "daily";
})(KnowledgeKind || (KnowledgeKind = {}));
export var CanonicalType;
(function (CanonicalType) {
    CanonicalType["Event"] = "event";
    CanonicalType["Knowledge"] = "knowledge";
    CanonicalType["Decision"] = "decision";
    CanonicalType["Incident"] = "incident";
    CanonicalType["Followup"] = "followup";
    CanonicalType["Reminder"] = "reminder";
})(CanonicalType || (CanonicalType = {}));
export var Importance;
(function (Importance) {
    Importance["Low"] = "low";
    Importance["Medium"] = "medium";
    Importance["High"] = "high";
})(Importance || (Importance = {}));
export var KnowledgeStatus;
(function (KnowledgeStatus) {
    KnowledgeStatus["Open"] = "open";
    KnowledgeStatus["Active"] = "active";
    KnowledgeStatus["Resolved"] = "resolved";
    KnowledgeStatus["Archived"] = "archived";
})(KnowledgeStatus || (KnowledgeStatus = {}));
export var ReviewFindingSeverity;
(function (ReviewFindingSeverity) {
    ReviewFindingSeverity["Low"] = "low";
    ReviewFindingSeverity["Medium"] = "medium";
    ReviewFindingSeverity["High"] = "high";
})(ReviewFindingSeverity || (ReviewFindingSeverity = {}));
export var ConversationPhase;
(function (ConversationPhase) {
    ConversationPhase["Idle"] = "idle";
    ConversationPhase["AwaitingKind"] = "awaiting_kind";
    ConversationPhase["AwaitingProject"] = "awaiting_project";
    ConversationPhase["AwaitingReminderDate"] = "awaiting_reminder_date";
    ConversationPhase["AwaitingReminderTime"] = "awaiting_reminder_time";
    ConversationPhase["AwaitingConfirmation"] = "awaiting_confirmation";
})(ConversationPhase || (ConversationPhase = {}));
export var ConversationMissingField;
(function (ConversationMissingField) {
    ConversationMissingField["ProjectSlug"] = "projectSlug";
    ConversationMissingField["Kind"] = "kind";
    ConversationMissingField["RawText"] = "rawText";
    ConversationMissingField["ReminderDate"] = "reminderDate";
    ConversationMissingField["ReminderTime"] = "reminderTime";
    ConversationMissingField["Confirmation"] = "confirmation";
})(ConversationMissingField || (ConversationMissingField = {}));
export var ConversationConfidence;
(function (ConversationConfidence) {
    ConversationConfidence["High"] = "high";
    ConversationConfidence["Medium"] = "medium";
    ConversationConfidence["Low"] = "low";
})(ConversationConfidence || (ConversationConfidence = {}));
export var QueryMode;
(function (QueryMode) {
    QueryMode["Search"] = "search";
    QueryMode["Answer"] = "answer";
})(QueryMode || (QueryMode = {}));
export var OnboardingOperation;
(function (OnboardingOperation) {
    OnboardingOperation["Upsert"] = "upsert";
    OnboardingOperation["Status"] = "status";
})(OnboardingOperation || (OnboardingOperation = {}));
export var IntegrationProvider;
(function (IntegrationProvider) {
    IntegrationProvider["Telegram"] = "telegram";
    IntegrationProvider["Whatsapp"] = "whatsapp";
    IntegrationProvider["Evolution"] = "evolution";
    IntegrationProvider["AiReview"] = "ai-review";
    IntegrationProvider["AiConversation"] = "ai-conversation";
    IntegrationProvider["Github"] = "github";
    IntegrationProvider["GithubApp"] = "github-app";
})(IntegrationProvider || (IntegrationProvider = {}));
export var ExternalIdentityProvider;
(function (ExternalIdentityProvider) {
    ExternalIdentityProvider["Telegram"] = "telegram";
    ExternalIdentityProvider["Whatsapp"] = "whatsapp";
    ExternalIdentityProvider["Github"] = "github";
    ExternalIdentityProvider["GithubApp"] = "github-app";
})(ExternalIdentityProvider || (ExternalIdentityProvider = {}));
export var IntegrationSetupStatus;
(function (IntegrationSetupStatus) {
    IntegrationSetupStatus["Connected"] = "connected";
    IntegrationSetupStatus["Partial"] = "partial";
    IntegrationSetupStatus["Missing"] = "missing";
})(IntegrationSetupStatus || (IntegrationSetupStatus = {}));
export var StoredIntegrationStatus;
(function (StoredIntegrationStatus) {
    StoredIntegrationStatus["Connected"] = "connected";
    StoredIntegrationStatus["Missing"] = "missing";
    StoredIntegrationStatus["Revoked"] = "revoked";
})(StoredIntegrationStatus || (StoredIntegrationStatus = {}));
export var CredentialRecordStatus;
(function (CredentialRecordStatus) {
    CredentialRecordStatus["Connected"] = "connected";
    CredentialRecordStatus["Revoked"] = "revoked";
})(CredentialRecordStatus || (CredentialRecordStatus = {}));
export var WebhookEventStatus;
(function (WebhookEventStatus) {
    WebhookEventStatus["Rejected"] = "rejected";
    WebhookEventStatus["Resolved"] = "resolved";
    WebhookEventStatus["Processed"] = "processed";
    WebhookEventStatus["Failed"] = "failed";
})(WebhookEventStatus || (WebhookEventStatus = {}));
export var ReminderDispatchMode;
(function (ReminderDispatchMode) {
    ReminderDispatchMode["Daily"] = "daily";
    ReminderDispatchMode["Exact"] = "exact";
})(ReminderDispatchMode || (ReminderDispatchMode = {}));
export var HomeTargetKind;
(function (HomeTargetKind) {
    HomeTargetKind["Note"] = "note";
    HomeTargetKind["Review"] = "review";
    HomeTargetKind["Project"] = "project";
})(HomeTargetKind || (HomeTargetKind = {}));
export var HomePriorityType;
(function (HomePriorityType) {
    HomePriorityType["Reminder"] = "reminder";
    HomePriorityType["Finding"] = "finding";
    HomePriorityType["Incident"] = "incident";
    HomePriorityType["Followup"] = "followup";
})(HomePriorityType || (HomePriorityType = {}));
export var AiProvider;
(function (AiProvider) {
    AiProvider["OpenRouter"] = "openrouter";
    AiProvider["OpenAi"] = "openai";
    AiProvider["None"] = "none";
})(AiProvider || (AiProvider = {}));
export const integrationProviderValues = Object.values(IntegrationProvider);
