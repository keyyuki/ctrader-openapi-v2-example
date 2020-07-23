import * as getenv from 'dotenv';
getenv.config();
import { CtraderOpenApiService } from './service/CtraderopenApiService';

const params = {
  host: 'demo.ctraderapi.com',
  port: 5035,
  clientId: process.env.CLIENT_ID || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  accountId: +(process.env.ACCOUNT_ID || 0),
  accessToken: process.env.ACCESS_TOKEN || '',
};
const service = new CtraderOpenApiService(params);
/*
service.send('ProtoOASubscribeSpotsReq', {
  ctidTraderAccountId: service.accountId,
  symbolId: 3,
});

service.on('ProtoOASpotEvent', rs => {
  console.log(rs);
});
*/

async function factory() {
  console.log('start auth');
  await service.auth().catch(err => console.log(err));
  console.log('end auth');

  service
    .send('ProtoOAReconcileReq', {
      ctidTraderAccountId: service.accountId,
    })
    .then(rs => {
      console.log('close position', rs.payload);
    })
    .catch(err => {
      console.log('error on tick', err);
    });
}
factory();
