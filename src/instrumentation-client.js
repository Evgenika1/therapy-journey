import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentryScrub.js';

Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
