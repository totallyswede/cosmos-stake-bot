import {SimpleMessagingConnection, JsonRpcClient, JsonRpcRequest} from '@cosmjs/json-rpc';
import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import {
  SigningStargateClient,
  StargateClient,
  coin
} from "@cosmjs/stargate";
import assertIsBroadcastTxSuccess from "@cosmjs/stargate";

import { cosmosclient, rest, proto } from 'cosmos-client';
import { setBech32NetworkPrefix } from 'cosmos-client/esm/types/address/config'
import { DistributionExtension } from "@cosmjs/stargate/build/queries/distribution";
import { Configuration } from 'cosmos-client/cjs/openapi/configuration';
import { AccAddress } from 'cosmos-client/cjs/types';
import { isPluginRequired } from '@babel/preset-env';

let minimist = require('minimist')

interface IAppParameters{
  _ : any[],
  mnemonic : string,
  walletPrefix : string,
  networkName : string,
  tokenDenom : string,
  rpcEndpoint : string,
  restEndpoint : string,
  verifyWithWalletAddress? : string,
  claimRewards : boolean,
  stakeAvailableBalance : boolean,
  leaveMinimumBalance : number
}

interface IClientInfos {
  rest : cosmosclient.CosmosSDK,
  rpc : SigningStargateClient,
  restAddress: AccAddress
}

async function main(){
  const parameters = GetAndVerifyParameters();
  const clients = await InitClients( parameters );
  await ClaimRewards(clients, parameters);
  await StakeBalance(clients, parameters);
}

function setFromFromEnv( args: any, memberName: string, varName: string ){
  const fromEnv = process.env[varName] as string;
  if( fromEnv?.length > 0 ) {
    args[memberName] = fromEnv;
  }
}

function GetAndVerifyParameters() : IAppParameters{
// console.log(process.argv)

  var args = minimist(process.argv.slice(2), {
    string: [ 'mnemonic', 'walletPrefix', 'networkName', "tokenDenom", 'rpcEndpoint', 'restEndpoint', 'verifyWithWalletAddress', 'leaveMinimumBalance' ],
    boolean: [ 'claimRewards', 'stakeAvailableBalance' ],
    //alias: { h: 'help', v: 'version' },
    default: { 
      walletPrefix: "osmo", 
      networkName: 'osmosis-1', 
      tokenDenom: 'uosmo',
      rpcEndpoint: 'https://rpc-osmosis.blockapsis.com', 
      restEndpoint: 'https://lcd-osmosis.blockapsis.com', 
      claimRewards: false, 
      stakeAvailableBalance: false, 
      leaveMinimumBalance: '1' 
    },
    '--': false,
    stopEarly: true, /* populate _ with first non-option */
    unknown: ( param : any ) => {
        console.log( `Unknown paramater: ${param}`);
    }
  });

  setFromFromEnv( args, "mnemonic", "STAKEBOT_MNEMONIC");
  setFromFromEnv( args, "walletPrefix", "STAKEBOT_WALLET_PREFIX");
  setFromFromEnv( args, "networkName", "STAKEBOT_NETWORK_NAME");
  setFromFromEnv( args, "tokenDenom", "STAKEBOT_TOKEN_DENOM");
  setFromFromEnv( args, "rpcEndpoint", "STAKEBOT_RPC_ENDPOINT");
  setFromFromEnv( args, "restEndpoint", "STAKEBOT_REST_ENDPOINT");
  setFromFromEnv( args, "claimRewards", "STAKEBOT_CLAIM_REWARDS" );
  setFromFromEnv( args, "stakeAvailableBalance", "STAKEBOT_STAKE_AVAILABLE_BALANCE" );
  setFromFromEnv( args, "leaveMinimumBalance", "STAKEBOT_LEAVE_MINIMUM_BALANCE");
  setFromFromEnv( args, "verifyWithWalletAddress", "STAKEBOT_VERIFY_WITH_WALLET_ADDRESS");

  const params = args as IAppParameters;
  // console.log(params);

  if(params.mnemonic === undefined ){
    throw new Error(`Missing applicaiton argument: claimRewards`);
  }

  return params;
}

async function InitClients( params : IAppParameters ) : Promise<IClientInfos> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(params.mnemonic, { prefix: params.walletPrefix });
  const [account] = await wallet.getAccounts();

  setBech32NetworkPrefix( params.walletPrefix );

  const rpcClient = await SigningStargateClient.connectWithSigner(
      params.rpcEndpoint,
      wallet
  );
  const restClient = new cosmosclient.CosmosSDK(params.restEndpoint, params.networkName );
  
  const privKey = new proto.cosmos.crypto.secp256k1.PrivKey({
      key: await cosmosclient.generatePrivKeyFromMnemonic(params.mnemonic),
  });
  const pubKey = privKey.pubKey();
  const address = cosmosclient.AccAddress.fromPublicKey(pubKey);

  console.log( `Using wallet address ${address.toString()}`)

  return {rest:restClient, rpc: rpcClient, restAddress: address };
}

async function ClaimRewards( clients : IClientInfos, params: IAppParameters ) {
  let totalRewards = await rest.distribution
      .delegationTotalRewards(clients.rest, clients.restAddress )
      .then( res => res.data );
  
  if(totalRewards?.rewards?.length !== undefined && 
    totalRewards.rewards.length > 0 && 
    totalRewards?.total?.length !== undefined &&
    totalRewards.total.length > 0 ) {
      console.log(`Total rewards: ${totalRewards?.total[0].amount} ${totalRewards.total[0].denom}`);

    if(params.claimRewards) {
        const fee = GenerateFee(params);

        for( let delegationRewards of totalRewards.rewards ) {

          if(delegationRewards?.reward === undefined){
            continue;
          }

          let validatorAddress = delegationRewards?.validator_address;
          let rewardAmount = delegationRewards?.reward[0]?.amount;
          let rewardDenom = delegationRewards?.reward[0]?.denom;
          
          if(validatorAddress === undefined || 
            rewardAmount === undefined || 
            rewardDenom === undefined) {
            continue;
          }

          console.log(`${validatorAddress}\nReward: ${rewardAmount} ${rewardDenom}`);

          if( parseInt(rewardAmount) > 1000*1000) {
              const withdrawResult = await clients.rpc.withdrawRewards( clients.restAddress.toString(), validatorAddress, fee );
              console.log("Withdraw result:\n" + JSON.stringify(withdrawResult));
              var obj = JSON.parse((withdrawResult.rawLog as string).slice(1,-1));
              const claimedAmount = obj.events.filter( (e : any) => e.type == "withdraw_rewards")[0].attributes.filter( (a : any) => a.key == "amount" )[0].value
              console.log( "Claimed " + claimedAmount );
          }
          else{
              console.log("Not time to claim yet...");
          }
        }
    }
  }
  else{
    console.log("No rewards could be listed");
    return;
  }

  console.log("Rewards were claimed");
}

async function StakeBalance( clients : IClientInfos, params: IAppParameters ) {
  //const foo = await clients.rpc.getAllBalances( clients.restAddress.toString());
  //console.log(JSON.stringify(foo));
  if( !params.stakeAvailableBalance ){
    console.log(`Not staking, as stakeAvailableBalance is set to ${params.stakeAvailableBalance}`)
    return;
  }

  const delegations = await rest.staking
    .delegatorDelegations( clients.rest, clients.restAddress )
    .then( res => res.data.delegation_responses );
  const orderedDelegations = delegations.sort( (a : any, b : any) => parseInt(a?.balance?.amount ?? "0") - parseInt(b?.balance?.amount ?? "0") );
  const validatorWithLeastStaked = orderedDelegations[0];
  const currentAccountBalance = await clients.rpc.getBalance( clients.restAddress.toString(), params.tokenDenom);
  const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");
  if( currentAccountBalanceValue / 1000000 > 2 )
  {
      console.log(`Balance high enough to stake: ${currentAccountBalanceValue / 1000000}`);
      const delegateResult = await clients.rpc.delegateTokens(clients.restAddress.toString(), validatorWithLeastStaked.delegation?.validator_address, coin( (1 * 1000000).toString(), params.tokenDenom ), GenerateFee(params) );
      console.log(JSON.stringify(delegateResult));
  }
}

function GenerateFee( params : IAppParameters ){
  return {
    amount: [
      {
        denom: params.tokenDenom,
        amount: "7000",
      },
    ],
    gas: "200000", // 200k
  };
}

main();