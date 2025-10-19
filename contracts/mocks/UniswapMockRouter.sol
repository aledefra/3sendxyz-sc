// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract UniswapMockRouter is Ownable {
    constructor() Ownable(msg.sender) {}

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountA,
        uint amountB,
        uint, // minAmountA
        uint, // minAmountB
        address, // to
        uint // deadline
    ) public returns (uint, uint, uint) {
        IERC20 erc20TokenA = IERC20(tokenA);
        IERC20 erc20TokenB = IERC20(tokenB);
        uint usedAmountA = amountA - 100;
        uint usedAmountB = amountB - 100;
        erc20TokenA.transferFrom(msg.sender, address(this), usedAmountA);
        erc20TokenB.transferFrom(msg.sender, address(this), usedAmountB);

        return (usedAmountA, usedAmountB, 1);
    }

    function swapExactTokensForTokens(
        uint amount,
        uint, // minAmount
        address[] memory path,
        address to,
        uint // deadline
    ) public returns (uint[] memory) {
        uint[] memory result = new uint[](2);
        result[0] = 0;
        result[1] = (300000 * amount) / 1000000; // 0.3 USDC per R1
        IERC20(path[0]).transferFrom(msg.sender, address(this), amount);
        IERC20(path[1]).transfer(to, result[1]);
        return result;
    }
}
