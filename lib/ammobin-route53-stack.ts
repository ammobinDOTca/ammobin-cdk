import { Stack, App, StackProps } from 'aws-cdk-lib'



export interface AmmobinRoute53StackProps extends StackProps {
  domain: string
}

export class AmmobinRoute53Stack extends Stack {
  constructor(app: App, id: string, props: AmmobinRoute53StackProps) {
    super(app, id, props);
    // todo create domain records....
  }
}
