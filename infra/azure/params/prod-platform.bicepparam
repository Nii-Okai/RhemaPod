// Production platform (rg-rhemapod-prod): its own Container Apps environment,
// Postgres server and Azure Managed Redis. Nothing here is shared with dev/test.
using '../platform.bicep'

param platformName = 'prod'
param location = readEnvironmentVariable('AZURE_LOCATION', 'germanywestcentral')
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID')

param vnetAddressPrefix = '10.50.0.0/16'
param infrastructureSubnetPrefix = '10.50.0.0/23'

param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresStorageSizeGB = 32
// The privacy policy publishes 30 days of backup retention.
param postgresBackupRetentionDays = 30
param databaseNames = ['rhemapod']
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')

param redisMode = 'managed'
param managedRedisSku = 'Balanced_B0'
// Enabled doubles the Redis cost; without it a Redis maintenance event can
// sign people out. Turn on once there are real users.
param managedRedisHighAvailability = false

// Cost guardrails (DEPLOYMENT-AZURE.md §10).
param monthlyBudget = 120
param budgetAlertEmails = split(readEnvironmentVariable('BUDGET_ALERT_EMAILS', ''), ',')
param logDailyCapGb = '0.5'
param postgresStorageAutoGrow = true
