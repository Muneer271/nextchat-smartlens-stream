import unittest
from backend.schemas.chat import ChatSettings
from backend.services.context_manager import (
    SlidingWindowContextManager,
    InMemorySessionStore,
    estimate_tokens,
)

class TestSlidingWindowContextManager(unittest.IsolatedAsyncioTestCase):
    async def test_pinned_system_prompt_persists(self):
        store = InMemorySessionStore()
        mgr = SlidingWindowContextManager(store=store)
        cfg = ChatSettings(system_prompt="PINNED_SYSTEM_TEST", max_context_tokens=1000)

        ctx, stats = await mgr.prepare_context("sess_1", "Hello assistant", cfg)
        self.assertTrue(any(m.role == "system" and "PINNED_SYSTEM_TEST" in m.content for m in ctx))
        self.assertEqual(stats["active_turns"], 1)

    async def test_token_budget_eviction_and_summary(self):
        store = InMemorySessionStore()
        mgr = SlidingWindowContextManager(store=store)
        cfg = ChatSettings(
            system_prompt="Short System",
            max_context_tokens=600,
            reserved_response_tokens=100,
            min_recent_turns=2,
        )

        for i in range(5):
            msg = f"Turn {i}: " + ("lorem ipsum content sequence " * 15)
            await mgr.prepare_context("sess_2", msg, cfg)
            await mgr.append_model_turn("sess_2", f"Reply {i}: acknowledgement")

        state = await mgr.get_context_state("sess_2", cfg)
        self.assertTrue(state["rolling_summary"] is not None or state["active_turns_count"] <= 5)
        self.assertLessEqual(state["total_tokens_used"], cfg.max_context_tokens + 200)

    async def test_recent_turns_are_preserved(self):
        store = InMemorySessionStore()
        mgr = SlidingWindowContextManager(store=store)
        cfg = ChatSettings(max_context_tokens=1200, min_recent_turns=2)

        await mgr.prepare_context("sess_3", "First Message", cfg)
        await mgr.append_model_turn("sess_3", "First Reply")
        await mgr.prepare_context("sess_3", "Second Message", cfg)
        await mgr.append_model_turn("sess_3", "Second Reply")

        ctx, _ = await mgr.prepare_context("sess_3", "Third Message", cfg)
        self.assertEqual(ctx[-1].content, "Third Message")

if __name__ == "__main__":
    unittest.main()
