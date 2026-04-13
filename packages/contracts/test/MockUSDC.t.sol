// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC public token;
    address public alice = makeAddr("alice");

    function setUp() public {
        token = new MockUSDC();
    }

    function test_name() public view {
        assertEq(token.name(), "USD Coin (Mock)");
    }

    function test_symbol() public view {
        assertEq(token.symbol(), "USDC");
    }

    function test_decimals() public view {
        assertEq(token.decimals(), 6);
    }

    function test_mint() public {
        token.mint(alice, 1000e6);
        assertEq(token.balanceOf(alice), 1000e6);
    }

    function test_non_owner_cannot_mint() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 500e6);
    }
}
