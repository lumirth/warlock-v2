import { app, type Bindings } from './http-app.js';
import { runScheduledWorkflows } from './services/scheduled-workflows.js';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await runScheduledWorkflows(event, env, ctx);
  },
};
