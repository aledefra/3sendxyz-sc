// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract UniswapMockPair is Ownable {
    address public token0;
    address public token1;

    constructor(address _token0, address _token1) Ownable(msg.sender) {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
    {
        // 200000 USDC
        // 666666 R1
        return (
            uint112(200000 * 10 ** 6),
            uint112(666666 * 10 ** 18),
            uint32(block.timestamp)
        );
    }
}
