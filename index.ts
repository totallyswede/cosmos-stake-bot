import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import {
  SigningStargateClient,
  StargateClient,
  coin
} from "@cosmjs/stargate";

import { cosmosclient, rest, proto } from 'cosmos-client';
import { setBech32NetworkPrefix } from 'cosmos-client/esm/types/address/config'
import { HdPath, stringToPath } from "@cosmjs/crypto";
import { AccAddress } from 'cosmos-client/cjs/types';
import { cwd } from "process";

const { SecretClient } = require("@azure/keyvault-secrets");
const { DefaultAzureCredential } = require("@azure/identity");

let minimist = require('minimist')

interface IChainConfiguration{
  chainName : string,
  walletPrefix : string,
  networkName : string,
  tokenDenom : string,
  rpcEndpoint : string,
  restEndpoint : string,
  customDerivationPath? : string
}

const chainConfigs = require('./chainConfigs.json') as IChainConfiguration[];

interface IAppParameters{
  _ : any[],
  chainNames : string,
  mnemonic? : string,
  keyVaultName? : string,
  keyVaultSecretName? : string,
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
  try{
    const parameters = await GetAndVerifyParameters();
    const chainNames = parameters.chainNames.split(',');
    for( let chainName of chainNames ){
      const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
      if(filteredConfigs === undefined || filteredConfigs.length == 0)
      {
        console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
        continue;
      }
      
      const config = filteredConfigs[0];
  
      const clients = await InitClients( config, parameters );
      await ClaimRewards(config, clients, parameters);
      await StakeBalance(config, clients, parameters);
    }
  } catch( error : any ) {
    if(error.message !== undefined)
      console.error(error.message);
    else
      console.error( error );
  }
}

function setFromFromEnv( args: any, memberName: string, varName: string ){
  const fromEnv = process.env[varName] as string;
  if( fromEnv?.length > 0 ) {
    args[memberName] = fromEnv;
  }
}

async function GetAndVerifyParameters() : Promise<IAppParameters>{
  var args = minimist(process.argv.slice(2), {
    string: [ 'chainNames', 'mnemonic', 'keyVaultName', 'keyVaultSecretName', 'leaveMinimumBalance' ],
    boolean: [ 'claimRewards', 'stakeAvailableBalance' ],
    //alias: { h: 'help', v: 'version' },
    default: { 
      claimRewards: false, 
      stakeAvailableBalance: false, 
      leaveMinimumBalance: 500000 
    },
    '--': false,
    stopEarly: true, /* populate _ with first non-option */
    unknown: ( param : any ) => {
        console.log( `Unknown paramater: ${param}`);
    }
  });

  setFromFromEnv( args, "chainNames", "STAKEBOT_CHAIN_NAMES");
  setFromFromEnv( args, "mnemonic", "STAKEBOT_MNEMONIC");
  setFromFromEnv( args, "keyVaultName", "STAKEBOT_KEY_VAULT_NAME");
  setFromFromEnv( args, "keyVaultSecretName", "STAKEBOT_KEY_VAULT_SECRET_NAME");
  setFromFromEnv( args, "claimRewards", "STAKEBOT_CLAIM_REWARDS" );
  setFromFromEnv( args, "stakeAvailableBalance", "STAKEBOT_STAKE_AVAILABLE_BALANCE" );
  setFromFromEnv( args, "leaveMinimumBalance", "STAKEBOT_LEAVE_MINIMUM_BALANCE");

  const params = args as IAppParameters;

  if(params.chainNames === undefined ){
    throw new Error(`Missing application argument 'chainNames' (comma-separated string or names) or environment variable STAKEBOT_CHAIN_NAMES`);
  }

  if(params.mnemonic === undefined && ( params.keyVaultName === undefined || params.keyVaultSecretName === undefined ) ){
    throw new Error(`Application requires mnemonic for your wallet. Either\n1. Supply it directly using the 'mnemonic' CLI parameter or environment variable STAKEBOT_MNEMONIC\n2. Fetch it from Azure Key Vault by defining CLI parameters 'keyVaultName' + 'keyVaultSecretName' or environment variables STAKEBOT_KEYVAULT_NAME + STAKEBOT_KEY_VAULT_SECRET_NAME in conjunction with environment variables AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.`);
  }

  if( params.keyVaultName !== undefined && params.keyVaultSecretName !== undefined){
    console.log("Loading mnemonic from Azure Key Vault");
    const credential = new DefaultAzureCredential();

    const url = `https://${params.keyVaultName}.vault.azure.net`;
    const client = new SecretClient(url, credential);

    const response = await client.getSecret(params.keyVaultSecretName);
    params.mnemonic = response.value;
  }

  return params;
}

async function InitClients( config : IChainConfiguration, params : IAppParameters ) : Promise<IClientInfos> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(params.mnemonic, { prefix: config.walletPrefix, hdPaths: config.customDerivationPath ? [stringToPath(config.customDerivationPath)] : undefined });
  const [account] = await wallet.getAccounts();
console.log(account.address);

  setBech32NetworkPrefix( config.walletPrefix );

  const rpcClient = await SigningStargateClient.connectWithSigner(
    config.rpcEndpoint,
      wallet
  );
  const restClient = new cosmosclient.CosmosSDK(config.restEndpoint, config.networkName );
  
  const privKey = new proto.cosmos.crypto.secp256k1.PrivKey({
      key: await cosmosclient.generatePrivKeyFromMnemonic(params.mnemonic),
  });
  const pubKey = privKey.pubKey();
  const address = cosmosclient.AccAddress.fromPublicKey(pubKey);

  console.log( `\nUsing wallet address ${address.toString()}`)

  return {rest:restClient, rpc: rpcClient, restAddress: address };
}

async function ClaimRewards( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters ) {
  let totalRewards = await rest.distribution
      .delegationTotalRewards(clients.rest, clients.restAddress )
      .then( res => res.data );
  
  if(totalRewards?.rewards?.length !== undefined && 
    totalRewards.rewards.length > 0 && 
    totalRewards?.total?.length !== undefined &&
    totalRewards.total.length > 0 ) {
      console.log(`Total rewards awaiting claim: ${totalRewards?.total[0].amount} ${totalRewards.total[0].denom}`);

    if(params.claimRewards) {
        const fee = GenerateFee(config);

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

          console.log(`Rewards from\nValidator: ${validatorAddress}\nValue: ${rewardAmount} ${rewardDenom}`);

          if( parseInt(rewardAmount) > 1000000) {
              const withdrawResult = await clients.rpc.withdrawRewards( clients.restAddress.toString(), validatorAddress, fee );
              // console.log("Withdraw result:\n" + JSON.stringify(withdrawResult));
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
}

async function StakeBalance( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters ) {
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
  const currentAccountBalance = await clients.rpc.getBalance( clients.restAddress.toString(), config.tokenDenom);
  const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");
  if( currentAccountBalanceValue > params.leaveMinimumBalance * 2 )
  {
      console.log(`Balance high enough to stake: ${currentAccountBalanceValue / 1000000} / ${params.leaveMinimumBalance * 2 / 1000000}`);
      const balanceToStake = currentAccountBalanceValue - params.leaveMinimumBalance;
      const delegateResult = await clients.rpc.delegateTokens(clients.restAddress.toString(), validatorWithLeastStaked.delegation?.validator_address, coin( balanceToStake.toString(), config.tokenDenom ), GenerateFee(config) );
      console.log(`Successfully staked ${balanceToStake} ${config.tokenDenom}`);
      // console.log(JSON.stringify(delegateResult));
  }
  else{
    console.log( `Account balance ${currentAccountBalanceValue / 1000000} is too low. Won't stake.`)
  }
}

function GenerateFee( config : IChainConfiguration ){
  return {
    amount: [
      {
        denom: config.tokenDenom,
        amount: "7000",
      },
    ],
    gas: "200000", // 200k
  };
}

main();