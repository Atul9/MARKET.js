import Web3 from 'web3';
import BigNumber from 'bignumber.js';
// Types
import {
  ERC20,
  MarketCollateralPool,
  MarketContract,
  MARKETProtocolConfig,
  SignedOrder
} from '@marketprotocol/types';

import { Market, Utils } from '../src';
import { constants } from '../src/constants';

import {
  depositCollateralAsync,
  getUserAccountBalanceAsync,
  withdrawCollateralAsync
} from '../src/lib/Collateral';

import { createOrderHashAsync, createSignedOrderAsync } from '../src/lib/Order';

import { getContractAddress } from './utils';

import { OrderFilledCancelledLazyStore } from '../src/OrderFilledCancelledLazyStore';
import { JSONRPCResponsePayload } from '@0xproject/types';

describe('Order filled/cancelled store', async () => {
  let web3;
  let config: MARKETProtocolConfig;
  let market: Market;
  let orderLibAddress: string;
  let contractAddresses: string[];
  let contractAddress: string;
  let deploymentAddress: string;
  let maker: string;
  let taker: string;
  let deployedMarketContract: MarketContract;
  let collateralTokenAddress: string;
  let collateralToken: ERC20;
  let collateralPoolAddress;
  let collateralPool;
  let initialCredit: BigNumber;
  let fees: BigNumber;
  let orderQty: BigNumber;
  let price: BigNumber;
  let snapshotId: string;
  let signedOrder: SignedOrder;

  beforeAll(async () => {
    jest.setTimeout(30000);
    web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:9545'));
    config = { networkId: constants.NETWORK_ID_TRUFFLE };
    market = new Market(web3.currentProvider, config);
    orderLibAddress = getContractAddress('OrderLib', constants.NETWORK_ID_TRUFFLE);
    contractAddresses = await market.marketContractRegistry.getAddressWhiteList;
    contractAddress = contractAddresses[0];
    deploymentAddress = web3.eth.accounts[0];
    maker = web3.eth.accounts[3];
    taker = web3.eth.accounts[4];
    deployedMarketContract = await MarketContract.createAndValidate(web3, contractAddress);
    collateralTokenAddress = await deployedMarketContract.COLLATERAL_TOKEN_ADDRESS;
    collateralToken = await ERC20.createAndValidate(web3, collateralTokenAddress);
    collateralPoolAddress = await deployedMarketContract.MARKET_COLLATERAL_POOL_ADDRESS;
    collateralPool = await MarketCollateralPool.createAndValidate(web3, collateralPoolAddress);
    initialCredit = new BigNumber(1e23);
    orderQty = new BigNumber(100);
    price = new BigNumber(100000);
    fees = new BigNumber(0);
    let makerCollateral = await getUserAccountBalanceAsync(
      web3.currentProvider,
      collateralPoolAddress,
      maker
    );
    let takerCollateral = await getUserAccountBalanceAsync(
      web3.currentProvider,
      collateralPoolAddress,
      taker
    );
    await withdrawCollateralAsync(web3.currentProvider, collateralPoolAddress, makerCollateral, {
      from: maker
    });
    await withdrawCollateralAsync(web3.currentProvider, collateralPoolAddress, takerCollateral, {
      from: taker
    });
    signedOrder = await createSignedOrderAsync(
      web3.currentProvider,
      orderLibAddress,
      contractAddress,
      new BigNumber(Math.floor(Date.now() / 1000) + 60 * 60),
      constants.NULL_ADDRESS,
      maker,
      fees,
      constants.NULL_ADDRESS,
      fees,
      orderQty,
      price,
      orderQty,
      Utils.generatePseudoRandomSalt()
    );
  });

  beforeEach(async () => {
    snapshotId = await new Promise<string>((resolve, reject) => {
      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_snapshot',
        params: [],
        id: new Date().getTime()
      }, (err: Error, response: JSONRPCResponsePayload) => {
        if (err) {
          reject(err);
        }
        resolve(response.result);
      });
    });
    await collateralToken.transferTx(maker, initialCredit).send({ from: deploymentAddress });
    await collateralToken.approveTx(collateralPoolAddress, initialCredit).send({ from: maker });
    await depositCollateralAsync(web3.currentProvider, collateralPoolAddress, initialCredit, {
      from: maker
    });
    await collateralToken.transferTx(taker, initialCredit).send({ from: deploymentAddress });
    await collateralToken.approveTx(collateralPoolAddress, initialCredit).send({ from: taker });
    await depositCollateralAsync(web3.currentProvider, collateralPoolAddress, initialCredit, {
      from: taker
    });
  });

  afterEach(async () => {
    await new Promise<string>((resolve, reject) => {
      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_revert',
        params: [snapshotId],
        id: new Date().getTime()
      }, (err: Error, response: JSONRPCResponsePayload) => {
        if (err) {
          reject(err);
        }
        resolve(response.result);
      });
    });
  });

  it('Returns the uncached quantity', async () => {
    const tradeQty = new BigNumber(2);
    await market.tradeOrderAsync(signedOrder, new BigNumber(tradeQty), {
      from: taker,
      gas: 400000
    });

    const orderHash = await createOrderHashAsync(web3.currentProvider, orderLibAddress, signedOrder);
    const store = new OrderFilledCancelledLazyStore(market.marketContractWrapper);

    const qty = await store.getQtyAsync(deployedMarketContract.address, orderHash);

    expect(qty).toEqual(tradeQty);
  });

  it('Returns the cached quantity', async () => {
    const tradeQty = new BigNumber(2);
    await market.tradeOrderAsync(signedOrder, new BigNumber(tradeQty), {
      from: taker,
      gas: 400000
    });

    const orderHash = await createOrderHashAsync(web3.currentProvider, orderLibAddress, signedOrder);
    const store = new OrderFilledCancelledLazyStore(market.marketContractWrapper);

    await store.getQtyAsync(deployedMarketContract.address, orderHash);
    const qty = await store.getQtyAsync(deployedMarketContract.address, orderHash);

    expect(qty).toEqual(tradeQty);
  });
});