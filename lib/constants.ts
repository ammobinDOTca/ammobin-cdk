import { RetentionDays } from "@aws-cdk/aws-logs"

export const LOG_RETENTION = RetentionDays.ONE_WEEK

export declare type Stage = 'prod' | 'beta'

export declare type Region = 'CA'

export const serviceName = 'ammobin'

