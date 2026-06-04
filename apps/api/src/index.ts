import { app, type Bindings } from './http-app.js';
import { dispatchScheduledWorkflows } from './services/scheduled-workflows.js';

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    dispatchScheduledWorkflows({
      cron: event.cron,
      env,
      waitUntil: workflow => ctx.waitUntil(workflow),
    });
  },
};
