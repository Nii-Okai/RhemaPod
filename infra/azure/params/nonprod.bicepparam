// Platform shared by dev and test (rg-rhemapod-nonprod): one Container Apps
// environment that scales to zero, one Burstable B1ms Postgres server with a
// database each (the size a new Azure free account covers for 12 months), and
// one Redis container that dev and test use as database 0 and 1.
using '../platform.bicep'

param platformName = 'nonprod'
param location = readEnvironmentVariable('AZURE_LOCATION', 'germanywestcentral')
param deployerObjectId = readEnvironmentVariable('DEPLOYER_OBJECT_ID')

param vnetAddressPrefix = '10.40.0.0/16'
param infrastructureSubnetPrefix = '10.40.0.0/23'

param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
param postgresStorageSizeGB = 32
param postgresBackupRetentionDays = 7
param databaseNames = ['rhemapod_dev', 'rhemapod_test']
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')

param redisMode = 'container'
param redisPassword = readEnvironmentVariable('REDIS_PASSWORD', '')

// Cost guardrails (DEPLOYMENT-AZURE.md §10).
param monthlyBudget = 15
param budgetAlertEmails = split(readEnvironmentVariable('BUDGET_ALERT_EMAILS', ''), ',')
param logDailyCapGb = '0.15'
param postgresStorageAutoGrow = false
