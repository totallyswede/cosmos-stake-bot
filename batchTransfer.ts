import { E6, IAccountConfiguration, IChainConfiguration, GenerateFee } from "./common";


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
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";


let minimist = require('minimist')

// interface IChainConfiguration{
//   chainName : string,
//   walletPrefix : string,
//   networkName : string,
//   tokenDenom : string,
//   rpcEndpoint : string,
//   restEndpoint : string,
//   customDerivationPath? : string
// }

// interface IAccountConfiguration{
//   accountName : string,
//   mnemonic : string,
//   chainNames : string,
//   claimRewards : boolean,
//   stakeAvailableBalance : boolean,
//   leaveMinimumBalance : Decimal
// }

//保存各个账户的返回信息
interface IBatchConfig{
  many2one : IMany2One,
  one2many : IOne2Many,

}

interface IMany2One{
  enable : boolean,
  chain: string,
  destAddress: string,
  transferToken: string,
  transferAmount: number,
  leftMinAmount: number,
}

interface IOne2Many{
  enable : boolean,
  chain: string,
  sourceAccountName: string,
  destAccountNames: string,
  transferToken: string,
  transferAmount: number
}



const chainConfigs = require('./chainConfigs.json') as IChainConfiguration[];

const accountConfigs = require('./accountConfigs.json') as IAccountConfiguration[];

const batchConfig = require('./batchConfig.json') as IBatchConfig;





interface IClientInfos {
  rest : cosmosclient.CosmosSDK,
  rpc : SigningStargateClient,
  restAddress: AccAddress
}


//main function
async function main(){
  try{

    if(batchConfig.many2one.enable) {
      const destAddress = batchConfig.many2one.destAddress;
      const transferAmount = batchConfig.many2one.transferAmount * E6;
      const leftMinAmount = batchConfig.many2one.leftMinAmount * E6;

      const transferToken = batchConfig.many2one.transferToken;
      const chainName = batchConfig.many2one.chain
  
      const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
      if(filteredConfigs === undefined || filteredConfigs.length == 0)
      {
        console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
        return;
      }
      const config = filteredConfigs[0];
      for( let accountConfig of accountConfigs ){
        //define cosmos client
        const clients = await InitClients( config , accountConfig);
        const sourceAddress = clients.restAddress.toString();
        const currentAccountBalance = await clients.rpc.getBalance( sourceAddress, transferToken);
        const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");

        if(sourceAddress == destAddress) {
          break;
        }

        let final_transfer_amount = transferAmount;
        if(transferAmount== 0) {
          final_transfer_amount = currentAccountBalanceValue - leftMinAmount;
        }

        if(final_transfer_amount > leftMinAmount) {
          await TransferToken(config, clients, sourceAddress, destAddress, transferToken, final_transfer_amount, accountConfig.accountName)
        } else {
          console.log(`${accountConfig.accountName} The left amount ${currentAccountBalanceValue} is too small!`)
        }
      }
    }
    if(batchConfig.one2many.enable) {
      let aryDestAddress = new Array()
      const batchConfigOne2Many = batchConfig.one2many;
      const transferToken = batchConfigOne2Many.transferToken;
      const transferAmount  = batchConfigOne2Many.transferAmount * E6;

      const chainName = batchConfigOne2Many.chain;
      const sourceAccountName = batchConfigOne2Many.sourceAccountName;
  
      //query chain config
      const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
      if(filteredConfigs === undefined || filteredConfigs.length == 0)
      {
        console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
        return;
      }
      const config = filteredConfigs[0];

      //query account configs
      const filteredAccountfigs = accountConfigs.filter( (a : IAccountConfiguration) => a.accountName == sourceAccountName );
      if(filteredAccountfigs === undefined || filteredAccountfigs.length == 0) {
        console.log(`\nCould not find configuration for account by given name '${sourceAccountName}'! Continuing...`);
        return;
      }
      const accountConfig = filteredAccountfigs[0];
      const clients = await InitClients( config , accountConfig);
      const sourceAddress = clients.restAddress.toString();
      const currentAccountBalance = await clients.rpc.getBalance( sourceAddress, transferToken);
      const currentAccountBalanceValue = parseInt(currentAccountBalance?.amount ?? "0");


      //生成目标地址数组和源账户client
      const destAccountNames = batchConfigOne2Many.destAccountNames.split(',');

      for( let accountConfig of accountConfigs ){
        const filterDestAccountName = destAccountNames.filter( (c : string) => c == accountConfig.accountName );
        if(filterDestAccountName !== undefined && filterDestAccountName.length > 0)
        {
          const destAddress = await GetAccountAddress( config , accountConfig);
          aryDestAddress.push(destAddress);
        }
      }

      if(currentAccountBalanceValue < transferAmount * aryDestAddress.length * 1.005) {
        console.log(`\nCould not find configuration for account by given name '${sourceAccountName}'! Continuing...`);
        return;
      }

      //开始批量转账
      for(let destAddress of aryDestAddress) {

        await TransferToken(config, clients, sourceAddress, destAddress, transferToken, transferAmount, accountConfig.accountName)
      }
    }

    
  } catch( error : any ) {
    if(error.message !== undefined)
      console.error(error.message);
    else
      console.error( error );
  }

}


async function InitClients( config : IChainConfiguration,accountConfig :IAccountConfiguration) : Promise<IClientInfos> {
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

// 根据助记词和chain生成地址
async function GetAccountAddress( config : IChainConfiguration,accountConfig :IAccountConfiguration) : Promise<string> {

  setBech32NetworkPrefix( config.walletPrefix );

  const privKey = new proto.cosmos.crypto.secp256k1.PrivKey({
      key: await cosmosclient.generatePrivKeyFromMnemonic(accountConfig.mnemonic),
  });
  const pubKey = privKey.pubKey();
  const address = cosmosclient.AccAddress.fromPublicKey(pubKey);

  return address.toString();
}



async function TransferToken( config : IChainConfiguration,clients : IClientInfos, sender: string, receiver: string, utoken:string, amount: number, accountName: string) {
    if(sender == receiver) {
      return;
    }
    let token: Coin = {
        denom: utoken,
        amount: amount.toString()
    };
    // const token = Coin(amount/E6, utoken);
    let transferAmount :Coin[] = [token];
    console.log(`${accountName} start to transfer >>>>>>>>>>>>>>`)
    console.log(`send ${amount}${utoken} from ${sender} to ${receiver} `)

    const result = await clients.rpc.sendTokens(sender, receiver,transferAmount, GenerateFee(config) );
  
    console.log(result)
}



function convertAmount( amount : string ): number{
  return Number(amount) / 1000000;
}

main();