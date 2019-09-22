#!/usr/bin/env node
import cdk = require('@aws-cdk/core');
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack';

const app = new cdk.App();
new AmmobinCdkStack(app, 'AmmobinCdkStack');