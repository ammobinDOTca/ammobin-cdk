import { RetentionDays } from "aws-cdk-lib/aws-logs"

import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda'
export const LOG_RETENTION = RetentionDays.ONE_WEEK

export declare type Stage = 'prod' | 'beta'

export declare type Region = 'CA' | 'US'

export const serviceName = 'ammobin'

export const TEST_LAMBDA_NAME = 'ammobinIntegTest'

/**
 * how often to refresh
 */
export const REFRESH_HOURS = 24 //things are hot right now. todo restore 24 once its cooled off

export const CLEANER_HOURS = 24 * 65 // clean out records every Xdays
/**
 * lambda runtime nodejs version
 */
export const RUNTIME = Runtime.NODEJS_18_X

export const ARCH = Architecture.ARM_64
