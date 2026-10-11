import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './openapi';

const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openapiDocument);
});

docsRouter.use(swaggerUi.serve);
docsRouter.get('/', swaggerUi.setup(undefined, {
  customSiteTitle: 'Class Management — API Docs',
  swaggerOptions: {
    url: '/api/docs/openapi.json',
    deepLinking: true,
    withCredentials: true,
    persistAuthorization: false,
    validatorUrl: null,
    queryConfigEnabled: false,
  },
}));

export default docsRouter;
