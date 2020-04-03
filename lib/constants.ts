import { RetentionDays } from "@aws-cdk/aws-logs"

export const LOG_RETENTION = RetentionDays.ONE_WEEK

export declare type Stage = 'prod' | 'beta'

export declare type Region = 'CA'

export const serviceName = 'ammobin'

export const TEST_LAMBDA_NAME = 'ammobinIntegTest'

/**
 * how often to refresh
 */
export const REFRESH_HOURS = 24 //things are hot right now. todo restore 24 once its cooled off
