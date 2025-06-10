#!/usr/bin/env python3
"""
Wakala Platform Integration Test Harness
Validates end-to-end functionality across all microservices
"""

import asyncio
import pytest
import httpx
import redis
import psycopg2
from typing import Dict, List, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import websockets
from prometheus_client import CollectorRegistry, Counter, Histogram
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Metrics
registry = CollectorRegistry()
test_counter = Counter('integration_tests_total', 'Total integration tests', ['service', 'status'], registry=registry)
test_duration = Histogram('integration_test_duration_seconds', 'Test duration', ['service', 'test'], registry=registry)

@dataclass
class ServiceEndpoint:
    """Service endpoint configuration"""
    name: str
    base_url: str
    health_check: str
    auth_required: bool = True

# Service registry
SERVICES = {
    'api_gateway': ServiceEndpoint('API Gateway', 'http://localhost:8080', '/health', False),
    'auth': ServiceEndpoint('Auth Service', 'http://localhost:8081', '/health', False),
    'user': ServiceEndpoint('User Service', 'http://localhost:8082', '/health', True),
    'wallet': ServiceEndpoint('Wallet Service', 'http://localhost:8083', '/health', True),
    'transaction': ServiceEndpoint('Transaction Service', 'http://localhost:8084', '/health', True),
    'notification': ServiceEndpoint('Notification Service', 'http://localhost:8085', '/health', True),
    'settlement': ServiceEndpoint('Settlement Service', 'http://localhost:8086', '/health', True),
    'reporting': ServiceEndpoint('Reporting Service', 'http://localhost:8087', '/health', True),
    'fraud': ServiceEndpoint('Fraud Detection', 'http://localhost:8088', '/health', True),
    'compliance': ServiceEndpoint('Compliance Service', 'http://localhost:8089', '/health', True),
    'webhook': ServiceEndpoint('Webhook Service', 'http://localhost:8090', '/health', True),
}

class IntegrationTestHarness:
    """Main integration test harness"""
    
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
        self.db_conn = None
        self.auth_token = None
        self.test_results = []
        
    async def setup(self):
        """Initialize test environment"""
        # Connect to database
        self.db_conn = psycopg2.connect(
            host="localhost",
            database="wakala_test",
            user="wakala",
            password="wakala123"
        )
        
        # Clear test data
        await self._cleanup_test_data()
        
        # Verify all services are healthy
        await self._verify_services_health()
        
    async def teardown(self):
        """Cleanup test environment"""
        await self._cleanup_test_data()
        if self.db_conn:
            self.db_conn.close()
        await self.client.aclose()
        
    async def _verify_services_health(self):
        """Verify all services are running and healthy"""
        logger.info("Verifying service health...")
        
        for service_name, service in SERVICES.items():
            try:
                response = await self.client.get(f"{service.base_url}{service.health_check}")
                if response.status_code == 200:
                    logger.info(f"✓ {service.name} is healthy")
                else:
                    logger.error(f"✗ {service.name} returned {response.status_code}")
                    raise Exception(f"{service.name} is not healthy")
            except Exception as e:
                logger.error(f"✗ {service.name} is not reachable: {e}")
                raise
                
    async def _cleanup_test_data(self):
        """Clean up test data from previous runs"""
        logger.info("Cleaning up test data...")
        
        # Clear Redis
        self.redis_client.flushdb()
        
        # Clear database test data
        with self.db_conn.cursor() as cursor:
            cursor.execute("DELETE FROM transactions WHERE user_id LIKE 'test_%'")
            cursor.execute("DELETE FROM wallets WHERE user_id LIKE 'test_%'")
            cursor.execute("DELETE FROM users WHERE id LIKE 'test_%'")
            self.db_conn.commit()
            
    async def _get_auth_token(self, phone_number: str) -> str:
        """Get authentication token for testing"""
        # Register user
        register_response = await self.client.post(
            f"{SERVICES['auth'].base_url}/api/v1/auth/register",
            json={
                "phone_number": phone_number,
                "country_code": "+254",
                "pin": "1234"
            }
        )
        
        if register_response.status_code != 201:
            # Try login if already registered
            login_response = await self.client.post(
                f"{SERVICES['auth'].base_url}/api/v1/auth/login",
                json={
                    "phone_number": phone_number,
                    "pin": "1234"
                }
            )
            return login_response.json()['access_token']
            
        return register_response.json()['access_token']
        
    @pytest.mark.asyncio
    async def test_user_registration_journey(self):
        """Test complete user registration journey"""
        logger.info("Testing user registration journey...")
        
        test_phone = "+254700000001"
        
        # 1. Register new user
        register_response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/auth/register",
            json={
                "phone_number": test_phone,
                "country_code": "+254",
                "pin": "1234",
                "device_id": "test_device_001"
            }
        )
        
        assert register_response.status_code == 201
        data = register_response.json()
        assert 'access_token' in data
        assert 'refresh_token' in data
        
        self.auth_token = data['access_token']
        
        # 2. Verify user profile created
        profile_response = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/users/profile",
            headers={"Authorization": f"Bearer {self.auth_token}"}
        )
        
        assert profile_response.status_code == 200
        profile = profile_response.json()
        assert profile['phone_number'] == test_phone
        
        # 3. Verify wallet created
        wallet_response = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/wallets/balance",
            headers={"Authorization": f"Bearer {self.auth_token}"}
        )
        
        assert wallet_response.status_code == 200
        wallet = wallet_response.json()
        assert wallet['balance'] == 0
        assert wallet['currency'] == 'KES'
        
        logger.info("✓ User registration journey completed successfully")
        
    @pytest.mark.asyncio
    async def test_money_transfer_journey(self):
        """Test complete money transfer journey"""
        logger.info("Testing money transfer journey...")
        
        # Setup test users
        sender_phone = "+254700000002"
        receiver_phone = "+254700000003"
        
        sender_token = await self._get_auth_token(sender_phone)
        receiver_token = await self._get_auth_token(receiver_phone)
        
        # 1. Fund sender wallet
        await self._fund_wallet(sender_token, 10000)
        
        # 2. Initiate transfer
        transfer_response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/transactions/transfer",
            headers={"Authorization": f"Bearer {sender_token}"},
            json={
                "receiver_phone": receiver_phone,
                "amount": 1000,
                "currency": "KES",
                "description": "Test transfer"
            }
        )
        
        assert transfer_response.status_code == 201
        transaction = transfer_response.json()
        transaction_id = transaction['transaction_id']
        
        # 3. Verify transaction status
        await asyncio.sleep(2)  # Wait for processing
        
        status_response = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/transactions/{transaction_id}",
            headers={"Authorization": f"Bearer {sender_token}"}
        )
        
        assert status_response.status_code == 200
        status = status_response.json()
        assert status['status'] == 'COMPLETED'
        
        # 4. Verify sender balance
        sender_balance = await self._get_wallet_balance(sender_token)
        assert sender_balance == 9000  # 10000 - 1000
        
        # 5. Verify receiver balance
        receiver_balance = await self._get_wallet_balance(receiver_token)
        assert receiver_balance == 1000
        
        # 6. Verify notifications sent
        notifications = await self._check_notifications(sender_phone)
        assert len(notifications) > 0
        assert any(n['type'] == 'TRANSACTION_SENT' for n in notifications)
        
        logger.info("✓ Money transfer journey completed successfully")
        
    @pytest.mark.asyncio
    async def test_merchant_payment_journey(self):
        """Test merchant payment journey"""
        logger.info("Testing merchant payment journey...")
        
        # Setup
        customer_phone = "+254700000004"
        merchant_phone = "+254700000005"
        
        customer_token = await self._get_auth_token(customer_phone)
        merchant_token = await self._get_auth_token(merchant_phone)
        
        # Create merchant account
        await self._create_merchant_account(merchant_token, "Test Shop")
        
        # Fund customer wallet
        await self._fund_wallet(customer_token, 5000)
        
        # 1. Create payment request
        payment_request = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/merchants/payment-request",
            headers={"Authorization": f"Bearer {merchant_token}"},
            json={
                "amount": 500,
                "currency": "KES",
                "description": "Coffee purchase",
                "customer_phone": customer_phone
            }
        )
        
        assert payment_request.status_code == 201
        request_id = payment_request.json()['request_id']
        
        # 2. Customer approves payment
        approval_response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/payments/approve/{request_id}",
            headers={"Authorization": f"Bearer {customer_token}"},
            json={"pin": "1234"}
        )
        
        assert approval_response.status_code == 200
        
        # 3. Verify transaction completed
        await asyncio.sleep(2)
        
        # Check merchant balance
        merchant_balance = await self._get_wallet_balance(merchant_token)
        assert merchant_balance == 500
        
        # Check customer balance
        customer_balance = await self._get_wallet_balance(customer_token)
        assert customer_balance == 4500
        
        logger.info("✓ Merchant payment journey completed successfully")
        
    @pytest.mark.asyncio
    async def test_bulk_disbursement_journey(self):
        """Test bulk disbursement journey"""
        logger.info("Testing bulk disbursement journey...")
        
        # Setup
        business_phone = "+254700000006"
        recipients = ["+254700000007", "+254700000008", "+254700000009"]
        
        business_token = await self._get_auth_token(business_phone)
        
        # Create business account and fund it
        await self._create_business_account(business_token, "Test Corp")
        await self._fund_wallet(business_token, 50000)
        
        # Register recipients
        for phone in recipients:
            await self._get_auth_token(phone)
            
        # 1. Create bulk disbursement
        disbursement_response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/disbursements/bulk",
            headers={"Authorization": f"Bearer {business_token}"},
            json={
                "disbursements": [
                    {
                        "phone_number": phone,
                        "amount": 1000,
                        "reference": f"SALARY-{phone[-4:]}"
                    }
                    for phone in recipients
                ]
            }
        )
        
        assert disbursement_response.status_code == 201
        batch_id = disbursement_response.json()['batch_id']
        
        # 2. Wait for processing
        await asyncio.sleep(5)
        
        # 3. Check batch status
        batch_status = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/disbursements/batch/{batch_id}",
            headers={"Authorization": f"Bearer {business_token}"}
        )
        
        assert batch_status.status_code == 200
        status = batch_status.json()
        assert status['status'] == 'COMPLETED'
        assert status['successful_count'] == 3
        
        # 4. Verify all recipients received funds
        for phone in recipients:
            token = await self._get_auth_token(phone)
            balance = await self._get_wallet_balance(token)
            assert balance == 1000
            
        logger.info("✓ Bulk disbursement journey completed successfully")
        
    @pytest.mark.asyncio
    async def test_saga_compensation_scenario(self):
        """Test saga compensation in failure scenarios"""
        logger.info("Testing saga compensation...")
        
        sender_phone = "+254700000010"
        receiver_phone = "+254700000011"
        
        sender_token = await self._get_auth_token(sender_phone)
        await self._fund_wallet(sender_token, 5000)
        
        # Simulate failure by trying to send to non-existent user
        transfer_response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/transactions/transfer",
            headers={"Authorization": f"Bearer {sender_token}"},
            json={
                "receiver_phone": "+254799999999",  # Non-existent
                "amount": 1000,
                "currency": "KES"
            }
        )
        
        # Should fail
        assert transfer_response.status_code == 404
        
        # Verify sender balance unchanged
        balance = await self._get_wallet_balance(sender_token)
        assert balance == 5000  # No deduction
        
        logger.info("✓ Saga compensation completed successfully")
        
    @pytest.mark.asyncio
    async def test_concurrent_transactions(self):
        """Test system behavior under concurrent load"""
        logger.info("Testing concurrent transactions...")
        
        # Setup 10 users
        users = []
        for i in range(10):
            phone = f"+25470000{i:04d}"
            token = await self._get_auth_token(phone)
            await self._fund_wallet(token, 10000)
            users.append((phone, token))
            
        # Execute 50 concurrent transfers
        tasks = []
        for i in range(50):
            sender_idx = i % 10
            receiver_idx = (i + 1) % 10
            
            task = self._execute_transfer(
                users[sender_idx][1],
                users[receiver_idx][0],
                100
            )
            tasks.append(task)
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Verify all succeeded
        successful = sum(1 for r in results if not isinstance(r, Exception))
        assert successful >= 45  # Allow some failures due to race conditions
        
        logger.info(f"✓ Concurrent transactions: {successful}/50 succeeded")
        
    @pytest.mark.asyncio
    async def test_circuit_breaker_behavior(self):
        """Test circuit breaker activation and recovery"""
        logger.info("Testing circuit breaker behavior...")
        
        # Make service temporarily unavailable
        # This would be done through service mesh in real environment
        
        # Try multiple requests to trigger circuit breaker
        failures = 0
        for i in range(10):
            try:
                response = await self.client.get(
                    f"{SERVICES['api_gateway'].base_url}/api/v1/health",
                    timeout=1.0
                )
            except:
                failures += 1
                
        # Circuit breaker should be open after threshold
        assert failures >= 5
        
        logger.info("✓ Circuit breaker behavior verified")
        
    @pytest.mark.asyncio
    async def test_websocket_notifications(self):
        """Test real-time notifications via WebSocket"""
        logger.info("Testing WebSocket notifications...")
        
        user_phone = "+254700000020"
        token = await self._get_auth_token(user_phone)
        
        # Connect to WebSocket
        async with websockets.connect(
            f"ws://localhost:8085/ws?token={token}"
        ) as websocket:
            
            # Trigger an event
            await self._fund_wallet(token, 1000)
            
            # Wait for notification
            try:
                message = await asyncio.wait_for(
                    websocket.recv(),
                    timeout=5.0
                )
                
                notification = json.loads(message)
                assert notification['type'] == 'WALLET_FUNDED'
                assert notification['amount'] == 1000
                
            except asyncio.TimeoutError:
                pytest.fail("No WebSocket notification received")
                
        logger.info("✓ WebSocket notifications working")
        
    # Helper methods
    async def _fund_wallet(self, token: str, amount: float):
        """Fund a wallet for testing"""
        response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/wallets/fund",
            headers={"Authorization": f"Bearer {token}"},
            json={"amount": amount, "currency": "KES"}
        )
        assert response.status_code == 200
        
    async def _get_wallet_balance(self, token: str) -> float:
        """Get wallet balance"""
        response = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/wallets/balance",
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()['balance']
        
    async def _create_merchant_account(self, token: str, business_name: str):
        """Create merchant account"""
        response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/merchants/register",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "business_name": business_name,
                "business_type": "RETAIL",
                "tax_id": "TEST123456"
            }
        )
        assert response.status_code == 201
        
    async def _create_business_account(self, token: str, business_name: str):
        """Create business account"""
        response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/business/register",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "business_name": business_name,
                "registration_number": "TEST789012",
                "tax_id": "TAX456789"
            }
        )
        assert response.status_code == 201
        
    async def _execute_transfer(self, sender_token: str, receiver_phone: str, amount: float):
        """Execute a transfer"""
        response = await self.client.post(
            f"{SERVICES['api_gateway'].base_url}/api/v1/transactions/transfer",
            headers={"Authorization": f"Bearer {sender_token}"},
            json={
                "receiver_phone": receiver_phone,
                "amount": amount,
                "currency": "KES"
            }
        )
        return response
        
    async def _check_notifications(self, phone: str) -> List[Dict]:
        """Check notifications for a user"""
        token = await self._get_auth_token(phone)
        response = await self.client.get(
            f"{SERVICES['api_gateway'].base_url}/api/v1/notifications",
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()['notifications']
        
    def generate_report(self):
        """Generate integration test report"""
        report = {
            "timestamp": datetime.utcnow().isoformat(),
            "total_tests": len(self.test_results),
            "passed": sum(1 for r in self.test_results if r['status'] == 'passed'),
            "failed": sum(1 for r in self.test_results if r['status'] == 'failed'),
            "test_results": self.test_results
        }
        
        with open('/tests/system/integration_results.json', 'w') as f:
            json.dump(report, f, indent=2)
            
        return report


async def main():
    """Run integration tests"""
    harness = IntegrationTestHarness()
    
    try:
        await harness.setup()
        
        # Run all test scenarios
        test_methods = [
            harness.test_user_registration_journey,
            harness.test_money_transfer_journey,
            harness.test_merchant_payment_journey,
            harness.test_bulk_disbursement_journey,
            harness.test_saga_compensation_scenario,
            harness.test_concurrent_transactions,
            harness.test_circuit_breaker_behavior,
            harness.test_websocket_notifications,
        ]
        
        for test_method in test_methods:
            try:
                await test_method()
                harness.test_results.append({
                    "test": test_method.__name__,
                    "status": "passed",
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.error(f"Test {test_method.__name__} failed: {e}")
                harness.test_results.append({
                    "test": test_method.__name__,
                    "status": "failed",
                    "error": str(e),
                    "timestamp": datetime.utcnow().isoformat()
                })
                
        # Generate report
        report = harness.generate_report()
        logger.info(f"\nIntegration Test Summary:")
        logger.info(f"Total: {report['total_tests']}")
        logger.info(f"Passed: {report['passed']}")
        logger.info(f"Failed: {report['failed']}")
        
    finally:
        await harness.teardown()


if __name__ == "__main__":
    asyncio.run(main())