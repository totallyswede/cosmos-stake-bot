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
import { Decimal } from "@cosmjs/math";
import { Delegation } from "cosmos-client/cjs/openapi/api";

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

interface IAccountConfiguration{
  accountName : string,
  mnemonic : string,
  chainNames : string,
  claimRewards : boolean,
  stakeAvailableBalance : boolean,
  leaveMinimumBalance : Decimal
}

//保存各个账户的返回信息
interface IAccountInfo{
  accountName : string,
  accountInfo : IAccountChainInfo[],
  accountStakeInfo : IStakeChainInfo[],

}

interface IAccountChainInfo{
  chainName : string,
  chainAddress: string,
  tokens : ITokenInfo[],
}

interface IStakeChainInfo{
  chainName : string,
  chainAddress: string,
  token : ITokenInfo,
}

interface ITokenInfo{
  denom: string,
  amount: Number
}

const MapAccountInfo : Record<string, IAccountInfo> = {};


const chainConfigs = require('./chainConfigs.json') as IChainConfiguration[];

const accountConfigs = require('./accountConfigs.json') as IAccountConfiguration[];

const tokenMap = require('./tokenMap.json') as Record<string, string>;

const MIN_REWARD_AMOUNT = 200000

const TokenStakeAmounts : Record<string, number> = {};

const TokenAvailableAmounts : Record<string, number> = {};

interface IAppParameters{
  _ : any[],
  // chainNames : string,
  // mnemonic? : string,
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
    //define chain names
    // const chainNames = parameters.chainNames.split(',');
    for( let accountConfig of accountConfigs ){
      let accountName = accountConfig.accountName;

      let accountChain: IAccountInfo = {
        accountName: accountName,
        accountInfo: [],
        accountStakeInfo:[]
      };

      MapAccountInfo[accountName] = accountChain;
    }
    for( let accountConfig of accountConfigs ){
      // console.log(accountConfig.accountName);
      const chainNames = accountConfig.chainNames.split(',');
      let index = 0;
      for( let chainName of chainNames ){
        const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
        if(filteredConfigs === undefined || filteredConfigs.length == 0)
        {
          console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
          continue;
        }
        
        const config = filteredConfigs[0];
        //define cosmos client
        const clients = await InitClients( config, parameters , accountConfig);
        let accountName = accountConfig.accountName;
        
        // todo 
        if (parameters.claimRewards) {
          await ClaimRewards(config, clients, parameters, accountName);

        } else {
          // console.log("start to query available balances.")
          await GetAllBalance(config, clients, parameters, accountConfig, accountName);
          // 查询多链staking 的balance
          // console.log("start to query staking balances.")
          // if (index==0){
          await GetStakingBalance(clients, accountName);
          // }
          index++;
        }


        if (parameters.stakeAvailableBalance) {
          await StakeBalance(config, clients, parameters, accountName);

        }
        
      }
      index = 0;
    
    }
    if (!parameters.claimRewards) {

      //todo 输出balance的查询结果
      console.log(JSON.stringify(MapAccountInfo, null, 4));
      console.log(TokenAvailableAmounts);
      console.log(TokenStakeAmounts);
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
    string: [ 'keyVaultName', 'keyVaultSecretName', 'leaveMinimumBalance' ],
    boolean: [ 'claimRewards', 'stakeAvailableBalance' ],
    //alias: { h: 'help', v: 'version' },
    default: { 
      claimRewards: false, 
      stakeAvailableBalance: false, 
      leaveMinimumBalance: 50000
    },
    '--': false,
    stopEarly: true, /* populate _ with first non-option */
    unknown: ( param : any ) => {
        console.log( `Unknown paramater: ${param}`);
    }
  });

  // setFromFromEnv( args, "chainNames", "STAKEBOT_CHAIN_NAMES");
  // setFromFromEnv( args, "mnemonic", "STAKEBOT_MNEMONIC");
  setFromFromEnv( args, "keyVaultName", "STAKEBOT_KEY_VAULT_NAME");
  setFromFromEnv( args, "keyVaultSecretName", "STAKEBOT_KEY_VAULT_SECRET_NAME");
  setFromFromEnv( args, "claimRewards", "STAKEBOT_CLAIM_REWARDS" );
  setFromFromEnv( args, "stakeAvailableBalance", "STAKEBOT_STAKE_AVAILABLE_BALANCE" );
  setFromFromEnv( args, "leaveMinimumBalance", "STAKEBOT_LEAVE_MINIMUM_BALANCE");

  const params = args as IAppParameters;

  // if(params.chainNames === undefined ){
  //   throw new Error(`Missing application argument 'chainNames' (comma-separated string or names) or environment variable STAKEBOT_CHAIN_NAMES`);
  // }

  // if(params.mnemonic === undefined && ( params.keyVaultName === undefined || params.keyVaultSecretName === undefined ) ){
  //   throw new Error(`Application requires mnemonic for your wallet. Either\n1. Supply it directly using the 'mnemonic' CLI parameter or environment variable STAKEBOT_MNEMONIC\n2. Fetch it from Azure Key Vault by defining CLI parameters 'keyVaultName' + 'keyVaultSecretName' or environment variables STAKEBOT_KEYVAULT_NAME + STAKEBOT_KEY_VAULT_SECRET_NAME in conjunction with environment variables AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.`);
  // }

  // if( params.keyVaultName !== undefined && params.keyVaultSecretName !== undefined){
  //   console.log("Loading mnemonic from Azure Key Vault");
  //   const credential = new DefaultAzureCredential();

  //   const url = `https://${params.keyVaultName}.vault.azure.net`;
  //   const client = new SecretClient(url, credential);

  //   const response = await client.getSecret(params.keyVaultSecretName);
  //   params.mnemonic = response.value;
  // }

  return params;
}

//todo use accountFig instead
async function InitClients( config : IChainConfiguration, params : IAppParameters ,accountConfig :IAccountConfiguration) : Promise<IClientInfos> {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(accountConfig.mnemonic, { prefix: config.walletPrefix, hdPaths: config.customDerivationPath ? [stringToPath(config.customDerivationPath)] : undefined });
  const [account] = await wallet.getAccounts();
  // console.log(account.address);

  setBech32NetworkPrefix( config.walletPrefix );

  const rpcClient = await SigningStargateClient.connectWithSigner(
    config.rpcEndpoint,
      wallet
  );
  const restClient = new cosmosclient.CosmosSDK(config.restEndpoint, config.networkName );
  
  const privKey = new proto.cosmos.crypto.secp256k1.PrivKey({
      key: await cosmosclient.generatePrivKeyFromMnemonic(accountConfig.mnemonic),
  });
  const pubKey = privKey.pubKey();
  const address = cosmosclient.AccAddress.fromPublicKey(pubKey);

  // console.log( `\nUsing wallet address ${address.toString()}`)

  return {rest:restClient, rpc: rpcClient, restAddress: address };
}

async function ClaimRewards( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters, accoutnName: string) {
  let totalRewards = await rest.distribution
      .delegationTotalRewards(clients.rest, clients.restAddress )
      .then( res => res.data );
  console.log(`${accoutnName}: ${clients.restAddress}: start to claim >>>>>>>>>>>>>>`)

  if(totalRewards?.rewards?.length !== undefined && 
    totalRewards.rewards.length > 0 && 
    totalRewards?.total?.length !== undefined &&
    totalRewards.total.length > 0 ) {
      // console.log(`${accoutnName}: Total rewards awaiting claim: ${totalRewards?.total[0].amount} ${totalRewards.total[0].denom}`);

    if(params.claimRewards) {
        const fee = GenerateFee(config);

        for( let delegationRewards of totalRewards.rewards ) {

          if(delegationRewards?.reward === undefined){
            continue;
          }
          // console.log(delegationRewards);
          let validatorAddress = delegationRewards?.validator_address;

          for( let reward of delegationRewards?.reward) {

            // let rewardAmount = delegationRewards?.reward[0]?.amount;
            // let rewardDenom = delegationRewards?.reward[0]?.denom;
            let rewardAmount = reward.amount;
            let rewardDenom = reward.denom;
            if(validatorAddress === undefined || 
              rewardAmount === undefined || 
              rewardDenom === undefined) {
              continue;
            }
  
            console.log(`Rewards can be claimed: ${convertAmount(rewardAmount)} ${convertToken(rewardDenom)}`);
  
            if( parseInt(rewardAmount) > MIN_REWARD_AMOUNT) {
                const withdrawResult = await clients.rpc.withdrawRewards( clients.restAddress.toString(), validatorAddress, fee );
                // console.log("Withdraw result:\n" + JSON.stringify(withdrawResult));
                var obj = JSON.parse((withdrawResult.rawLog as string).slice(1,-1));
                const claimedAmount = obj.events.filter( (e : any) => e.type == "withdraw_rewards")[0].attributes.filter( (a : any) => a.key == "amount" )[0].value
                console.log( "========== Claimed " + claimedAmount +  "==========");
            }
            else{
                console.log("Not time to claim yet...");
            }
          }
          
        }
    }
  }
  else{
    console.log("No rewards could be listed");
    return;
  }
}

async function StakeBalance( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters, accoutnName: string) {
  //const foo = await clients.rpc.getAllBalances( clients.restAddress.toString());
  //console.log(JSON.stringify(foo));
  console.log(`${accoutnName}: start to stake >>>>>>>>>>>>>>`)
  if( !params.stakeAvailableBalance ){
    console.log(`Not staking, as stakeAvailableBalance is set to ${params.stakeAvailableBalance}`)
    return;
  }

  const delegations = await rest.staking
    .delegatorDelegations( clients.rest, clients.restAddress )
    .then( res => res.data.delegation_responses );
  const orderedDelegations = delegations.sort( (a : any, b : any) => parseInt(a?.balance?.amount ?? "0") - parseInt(b?.balance?.amount ?? "0") );
  const validatorWithLeastStaked = orderedDelegations[0];
  //todo 查询账户余额，只需要地址，不需要秘钥
  const currentAccountBalance = await clients.rpc.getBalance( clients.restAddress.toString(), config.tokenDenom);
  const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");
  // console.log( `leaveminimumbalance : ${params.leaveMinimumBalance} `)

  const temp = params.leaveMinimumBalance
  console.log( `leaveMinimumBalance : ${temp} `)

  if( currentAccountBalanceValue > params.leaveMinimumBalance * 2 )
  {
      //todo 显示当前账户余额
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

//显示所有链上的账户余额
async function DisplayBalance( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters, accountConfig :IAccountConfiguration) {

  //todo 查询账户余额，只需要地址，不需要秘钥
  const currentAccountBalance = await clients.rpc.getBalance( clients.restAddress.toString(), config.tokenDenom);
  const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");
  console.log( `leaveminimumbalance : ${params.leaveMinimumBalance} `)
  
  // const balances = await clients.rpc.getAllBalances(clients.restAddress.toString());

  console.log(`${clients.restAddress.toString()} Balance : ${currentAccountBalanceValue / 1000000}`);

}

//todo
async function GetAllBalance( config : IChainConfiguration, clients : IClientInfos, params: IAppParameters, accountConfig :IAccountConfiguration, accountName: string)  {
  // let accountChain1: IAccountChainInfo = {
  //   chainName: 'cosmos',
  //   chainAddress: "",
  //   tokens:[]
  // };
  // let aryAccountChains: IAccountChainInfo[] = [];
  //todo 查询账户余额，只需要地址，不需要秘钥
  // const currentAccountBalance = await clients.rpc.getBalance( clients.restAddress.toString(), config.tokenDenom);
  // const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");
  // console.log( `leaveminimumbalance : ${params.leaveMinimumBalance} `)
  
  const balances = await clients.rpc.getAllBalances(clients.restAddress.toString());
  if (balances.length > 0) {
    let accountChain: IAccountChainInfo = {
      chainName: config.chainName,
      chainAddress: clients.restAddress.toString(),
      tokens:[]
    };
    for( let coin of balances ){
      let tokenInfo: ITokenInfo = {
        denom: convertToken(coin.denom),
        amount: convertAmount(coin.amount)
      };
      accountChain.tokens.push(tokenInfo);
      TokenAvailableAmounts[accountName + "_" + config.chainName + "_" + convertToken(coin.denom)] = convertAmount(coin.amount);

    }
    MapAccountInfo[accountName].accountInfo.push(accountChain)

  }


  // console.log(clients.restAddress.toString())
  // console.log(1)
  // console.log(balances);

  // return aryAccountChains

}

//todo 
async function GetStakingBalance(clients : IClientInfos, accountName: string) {
  let stakeChain: IStakeChainInfo = {
    chainName: "",
    chainAddress: "",
    token: null
  };
  
  const delegations = await rest.staking
    .delegatorDelegations( clients.rest, clients.restAddress )
    .then( res => res.data.delegation_responses );
  
  // console.log(delegations);  
  for(let item of delegations) {

    let token: ITokenInfo = {
      denom: convertToken(item.balance.denom),
      amount: convertAmount(item.balance.amount)
    };
    stakeChain = {
      chainName: "",
      chainAddress: item.delegation.delegator_address,
      token: token
    };
    MapAccountInfo[accountName].accountStakeInfo.push(stakeChain)
    TokenStakeAmounts[accountName + "_" + convertToken(item.balance.denom)] = convertAmount(item.balance.amount);

    // aryStakeChains.push(stakeChain)

  }

  // return stakeChain;

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

function convertToken( denom : string ): string{
  if (tokenMap[denom]) {
    return tokenMap[denom]
  } else {
    return denom;

  }
}

function convertAmount( amount : string ): number{
  return Number(amount) / 1000000;
}

main();