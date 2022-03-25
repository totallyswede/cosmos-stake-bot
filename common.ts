
import { Decimal } from "@cosmjs/math";

export const E6 = 1000000

export interface IAccountConfiguration{
  accountName : string,
  mnemonic : string,
  chainNames : string,
  claimRewards : boolean,
  stakeAvailableBalance : boolean,
  leaveMinimumBalance : Decimal
}


export interface IChainConfiguration{
    chainName : string,
    walletPrefix : string,
    networkName : string,
    tokenDenom : string,
    gas:number,
    min_tx_fee:string
    rpcEndpoint : string,
    restEndpoint : string,
    customDerivationPath? : string
  }

// export interface ITokenInfo{
//   denom: string,
//   amount: Number
// }
export function GenerateFee( config : IChainConfiguration ){
    let fee = "7000";
    if(config.tokenDenom == "uosmo"){
      fee = "0";
    }
  
    return {
      amount: [
        {
          denom: config.tokenDenom,
          amount: fee,
        },
      ],
      gas: "200000", // 200k
    };
  }