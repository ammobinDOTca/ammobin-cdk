import { RetentionDays } from "@aws-cdk/aws-logs"

import { Runtime } from '@aws-cdk/aws-lambda'
export const LOG_RETENTION = RetentionDays.ONE_WEEK

export declare type Stage = 'prod' | 'beta'

export declare type Region = 'CA' | 'US'

export const serviceName = 'ammobin'

export const TEST_LAMBDA_NAME = 'ammobinIntegTest'

/**
 * how often to refresh
 */
export const REFRESH_HOURS = 24 //things are hot right now. todo restore 24 once its cooled off

/**
 * lambda runtime nodejs version
 */
export const RUNTIME = Runtime.NODEJS_16_X
