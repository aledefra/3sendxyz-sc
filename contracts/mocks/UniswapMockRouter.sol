// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2PairMock {
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function token0() external view returns (address);

    function token1() external view returns (address);
}

contract UniswapMockRouter is Ownable {
    uint256 public constant ETH_PRICE_USDC = 2_000_000_000; // $2,000 with 6 decimals

    address public immutable weth;
    IERC20 public immutable usdcToken;
    IERC20 public immutable r1Token;
    IUniswapV2PairMock public immutable pair;

    constructor(
        address pairAddress,
        address wethAddress,
        address usdcAddress,
        address r1Address
    ) Ownable(msg.sender) {
        require(pairAddress != address(0), "RouterMock: pair is zero");
        require(wethAddress != address(0), "RouterMock: WETH is zero");
        require(usdcAddress != address(0), "RouterMock: USDC is zero");
        require(r1Address != address(0), "RouterMock: R1 is zero");

        pair = IUniswapV2PairMock(pairAddress);
        weth = wethAddress;
        usdcToken = IERC20(usdcAddress);
        r1Token = IERC20(r1Address);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] memory path,
        address to,
        uint256 /* deadline */
    ) public returns (uint256[] memory amounts) {
        require(path.length == 2, "RouterMock: invalid path");
        require(path[0] == address(usdcToken), "RouterMock: unsupported input");
        require(path[1] == address(r1Token), "RouterMock: unsupported output");
        require(to != address(0), "RouterMock: zero receiver");

        usdcToken.transferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = _quote(amountIn);
        require(amountOut >= amountOutMin, "RouterMock: slippage");

        r1Token.transfer(to, amountOut);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] memory path,
        address to,
        uint256 /* deadline */
    ) public returns (uint256[] memory amounts) {
        require(path.length >= 2, "RouterMock: invalid path");
        require(path[path.length - 1] == address(usdcToken), "RouterMock: must target USDC");
        require(to != address(0), "RouterMock: zero receiver");

        uint256 requiredIn = amountOut * 1e12; // approximate 6 to 18 decimals scaling
        require(requiredIn > 0, "RouterMock: zero in");
        require(requiredIn <= amountInMax, "RouterMock: max input exceeded");

        IERC20(path[0]).transferFrom(msg.sender, address(this), requiredIn);
        usdcToken.transfer(to, amountOut);

        amounts = new uint256[](path.length);
        amounts[0] = requiredIn;
        amounts[path.length - 1] = amountOut;
    }

    function swapETHForExactTokens(
        uint256 amountOut,
        address[] memory path,
        address to,
        uint256 /* deadline */
    ) public payable returns (uint256[] memory amounts) {
        require(path.length == 2, "RouterMock: invalid path");
        require(path[0] == weth, "RouterMock: unsupported ETH path");
        require(path[1] == address(usdcToken), "RouterMock: unsupported output");
        require(to != address(0), "RouterMock: zero receiver");

        uint256 requiredEth = (amountOut * 1e18 + (ETH_PRICE_USDC - 1)) /
            ETH_PRICE_USDC;
        require(msg.value >= requiredEth, "RouterMock: insufficient ETH");

        usdcToken.transfer(to, amountOut);

        if (msg.value > requiredEth) {
            uint256 refund = msg.value - requiredEth;
            (bool success, ) = msg.sender.call{value: refund}("");
            require(success, "RouterMock: refund failed");
        }

        amounts = new uint256[](2);
        amounts[0] = requiredEth;
        amounts[1] = amountOut;
    }

    receive() external payable {}

    function _quote(uint256 usdcAmount) internal view returns (uint256) {
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        address token0 = pair.token0();
        address token1 = pair.token1();

        uint256 reserveUsdc;
        uint256 reserveR1;

        if (token0 == address(usdcToken) && token1 == address(r1Token)) {
            reserveUsdc = reserve0;
            reserveR1 = reserve1;
        } else if (token0 == address(r1Token) && token1 == address(usdcToken)) {
            reserveUsdc = reserve1;
            reserveR1 = reserve0;
        } else {
            revert("RouterMock: pair mismatch");
        }

        return (usdcAmount * reserveR1) / reserveUsdc;
    }
}
