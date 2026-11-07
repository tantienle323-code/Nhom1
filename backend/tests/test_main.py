import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class AuthTests(unittest.TestCase):
    def test_password_hash_preserves_whitespace(self):
        hashed = main.hash_password("password with spaces ")
        self.assertTrue(main.verify_password("password with spaces ", hashed))
        self.assertFalse(main.verify_password("password with spaces", hashed))

    def test_access_token_round_trip_and_tamper_detection(self):
        token = main.create_access_token("alice")
        self.assertEqual(main.decode_access_token(token), "alice")
        with self.assertRaises(HTTPException) as error:
            main.decode_access_token(token[:-1] + ("A" if token[-1] != "A" else "B"))
        self.assertEqual(error.exception.status_code, 401)

    def test_expired_access_token_is_rejected(self):
        with patch.object(main, "TOKEN_TTL_SECONDS", -1):
            token = main.create_access_token("alice")
        with self.assertRaises(HTTPException):
            main.decode_access_token(token)

    def test_invalid_auth_input_is_rejected(self):
        with self.assertRaises(ValidationError):
            main.AuthSchema(username="a!", password="short")
        with self.assertRaises(ValidationError):
            main.AuthSchema(username="alice", password="mật_khẩu" * 10)

    def test_private_room_id_is_order_independent(self):
        self.assertEqual(main.private_room_id("alice", "bob"), main.private_room_id("bob", "alice"))

    def test_room_membership_is_checked_against_registered_users(self):
        class Cursor:
            async def to_list(self, length):
                return [{"username": "bob"}]

        class Users:
            def find(self, query, projection):
                return Cursor()

        with patch.object(main, "user_collection", Users()):
            self.assertTrue(asyncio.run(main.is_room_member("chat_alice_bob", "alice")))
            self.assertFalse(asyncio.run(main.is_room_member("chat_alice_eve", "alice")))

    def test_auth_dependency_rejects_missing_credentials(self):
        with self.assertRaises(HTTPException) as error:
            asyncio.run(main.get_current_username(None))
        self.assertEqual(error.exception.status_code, 401)


class ChatUpgradeTests(unittest.IsolatedAsyncioTestCase):
    async def test_message_rate_limit_caps_room_user_pair(self):
        key = ("group_rate_test", "alice")
        main.message_rate_events.pop(key, None)
        with patch.object(main.time, "monotonic", side_effect=[100.0] * 9):
            for _ in range(main.MESSAGE_RATE_LIMIT):
                self.assertTrue(await main.allow_chat_message(*key))
            self.assertFalse(await main.allow_chat_message(*key))
        main.message_rate_events.pop(key, None)

    async def test_message_search_is_member_scoped_and_escapes_regex(self):
        class Cursor:
            def sort(self, *_):
                return self

            def limit(self, *_):
                return self

            async def to_list(self, length):
                return [{
                    "_id": main.ObjectId(),
                    "room": "group_search",
                    "sender": "bob",
                    "content": "literal a.b",
                    "reactions": {},
                }]

        class Messages:
            def find(self, query):
                self.query = query
                return Cursor()

        messages = Messages()
        with (
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "message_collection", messages),
        ):
            result = await main.search_room_messages(
                "group_search",
                "alice",
                q="a.b",
                sender="bob",
                date_from=None,
                date_to=None,
            )
        self.assertEqual(len(result), 1)
        self.assertEqual(messages.query["sender"], "bob")
        self.assertEqual(messages.query["content"]["$regex"], "a\\.b")

    async def test_pin_preferences_are_validated_against_room_membership(self):
        updates = []

        class State:
            async def update_one(self, query, update, upsert):
                updates.append((query, update, upsert))

        with (
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "chat_state_collection", State()),
        ):
            result = await main.set_pinned_room(
                main.PinnedRoomSchema(room="group_demo", pinned=True),
                "alice",
            )
        self.assertEqual(result, {"room": "group_demo", "pinned": True})
        self.assertEqual(updates[0][1], {"$addToSet": {"pinned_rooms": "group_demo"}})

    async def test_unread_state_uses_per_room_read_cursors(self):
        private_room = main.private_room_id("alice", "bob")
        group_room = "group_demo"
        cursor_id = main.ObjectId()

        class Cursor:
            async def to_list(self, length):
                return [{"_id": group_room}]

        class Groups:
            def find(self, query, projection):
                return Cursor()

        class Database:
            def __getitem__(self, name):
                if name != "groups":
                    raise AssertionError(name)
                return Groups()

        class Users:
            def find(self, query, projection):
                class UserCursor:
                    async def to_list(self, length):
                        return [{"username": "bob"}]
                return UserCursor()

        class Messages:
            async def distinct(self, field, query):
                return [private_room, group_room]

            async def count_documents(self, query):
                if query["room"] == private_room:
                    self.private_query = query
                    return 2
                self.group_query = query
                return 1

        class State:
            async def find_one(self, query):
                if query["_id"] == "alice":
                    return {"pinned_rooms": [group_room]}
                if query["_id"] == main.chat_room_state_id("alice", group_room):
                    return {"read_cursor": str(cursor_id)}
                return None

        messages = Messages()
        with (
            patch.object(main, "database", Database()),
            patch.object(main, "user_collection", Users()),
            patch.object(main, "message_collection", messages),
            patch.object(main, "chat_state_collection", State()),
        ):
            result = await main.get_chat_state("alice")

        self.assertEqual(result["unread_counts"], {private_room: 2, group_room: 1})
        self.assertEqual(result["total_unread"], 3)
        self.assertEqual(result["pinned_rooms"], [group_room])
        self.assertNotIn("_id", messages.private_query)
        self.assertEqual(messages.group_query["_id"]["$gt"], cursor_id)

    async def test_mark_chat_read_advances_cursor_and_broadcasts_receipt(self):
        message_id = main.ObjectId()
        updates = []
        room = "group_receipts"

        class Messages:
            async def find_one(self, query, projection, sort):
                return {"_id": message_id}

            async def update_many(self, query, update):
                updates.append((query, update))

        class State:
            async def update_one(self, query, update, upsert):
                updates.append((query, update, upsert))

        manager = type("Manager", (), {"broadcast_to_room": AsyncMock()})()
        with (
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "message_collection", Messages()),
            patch.object(main, "chat_state_collection", State()),
            patch.object(main, "manager", manager),
        ):
            result = await main.mark_chat_read(room, "alice")

        self.assertEqual(result["read_cursor"], str(message_id))
        self.assertEqual(updates[1][0]["_id"]["$lte"], message_id)
        self.assertIn("read_by.", next(iter(updates[1][1]["$set"])))
        manager.broadcast_to_room.assert_awaited_once_with(
            room, {"type": "read_receipt", "reader": "alice"}
        )

    async def test_empty_room_read_cursor_tracks_future_messages(self):
        state_updates = []

        class Messages:
            async def find_one(self, query, projection, sort):
                return None

            async def update_many(self, query, update):
                self.update = (query, update)

        class State:
            async def update_one(self, query, update, upsert):
                state_updates.append(update["$set"]["read_cursor"])

        with (
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "message_collection", Messages()),
            patch.object(main, "chat_state_collection", State()),
            patch.object(main, "manager", type(
                "Manager", (), {"broadcast_to_room": AsyncMock()}
            )()),
        ):
            result = await main.mark_chat_read("group_empty", "alice")

        self.assertEqual(result["read_cursor"], state_updates[0])
        self.assertTrue(main.ObjectId.is_valid(state_updates[0]))


class PrivateWorldTests(unittest.IsolatedAsyncioTestCase):
    async def test_world_progress_counts_messages_memories_and_games(self):
        progress = main.build_world_progress(message_count=5, memory_count=1, game_count=1)

        self.assertEqual(progress["score"], 30)
        self.assertEqual(progress["name"], "Quán quen")
        self.assertEqual(progress["level"], 3)
        self.assertEqual(progress["progress"], 0)

    async def test_world_requires_another_member_of_the_private_chat(self):
        with self.assertRaises(HTTPException) as self_chat:
            await main.require_world_room("alice", "alice")
        self.assertEqual(self_chat.exception.status_code, 400)

        with patch.object(main, "is_room_member", new=AsyncMock(return_value=False)):
            with self.assertRaises(HTTPException) as unknown_chat:
                await main.require_world_room("eve", "alice")
        self.assertEqual(unknown_chat.exception.status_code, 404)

    async def test_memory_schema_rejects_blank_title_and_trims_text(self):
        with self.assertRaises(ValidationError):
            main.WorldMemorySchema(title="   ")

        memory = main.WorldMemorySchema(title="  First memory  ", note="  A note  ")
        self.assertEqual(memory.title, "First memory")
        self.assertEqual(memory.note, "A note")

    async def test_shared_pet_schema_normalizes_name_and_rejects_unknown_species(self):
        pet = main.SharedPetCreateSchema(name="  Bánh Bao  ", species="rabbit")
        self.assertEqual(pet.name, "Bánh Bao")
        self.assertEqual(pet.species, "rabbit")
        self.assertEqual(pet.timezone_offset_minutes, 0)
        with self.assertRaises(ValidationError):
            main.SharedPetCreateSchema(name="   ", species="cat")
        with self.assertRaises(ValidationError):
            main.SharedPetCreateSchema(name="Miu", species="unicorn")
        with self.assertRaises(ValidationError):
            main.SharedPetCreateSchema(
                name="Miu",
                species="cat",
                timezone_offset_minutes=1000,
            )
        self.assertEqual(main.SharedPetActionSchema(action="groom").action, "groom")

    async def test_shared_pet_progress_is_persistent_and_does_not_decay(self):
        created_at = main.datetime.datetime.now(main.datetime.timezone.utc)
        pet = {
            "name": "Bánh Bao",
            "species": "cat",
            "created_by": "alice",
            "created_at": created_at,
            "experience": 55,
            "affection": 4,
            "interactions": 4,
        }

        presented = main.present_shared_pet(pet)

        self.assertEqual(presented["level"], 2)
        self.assertEqual(presented["experience_in_level"], 5)
        self.assertEqual(presented["affection"], 4)
        self.assertEqual(presented["emoji"], "🐱")
        self.assertIn("hunger", presented["needs"])

    async def test_shared_pet_needs_evolve_gently_and_nighttime_rest_restores_energy(self):
        start = main.datetime.datetime(2026, 11, 7, 8, tzinfo=main.datetime.timezone.utc)
        pet = {
            "name": "Bánh Bao",
            "species": "cat",
            "created_by": "alice",
            "created_at": start,
            "last_updated": start,
        }

        awake = main.advance_shared_pet(pet, start + main.datetime.timedelta(hours=8))
        night_start = start.replace(hour=22)
        pet["last_updated"] = night_start
        asleep = main.advance_shared_pet(
            pet,
            night_start + main.datetime.timedelta(hours=8),
        )

        self.assertAlmostEqual(awake["hunger"], 77.8)
        self.assertAlmostEqual(awake["energy"], 67.2)
        self.assertAlmostEqual(awake["happiness"], 71.4)
        self.assertAlmostEqual(asleep["energy"], 100)
        self.assertTrue(asleep["sleeping"])
        self.assertGreater(asleep["hunger"], 70)

    async def test_shared_pet_sleep_schedule_uses_adopting_browser_timezone(self):
        utc_now = main.datetime.datetime(2026, 11, 7, 15, tzinfo=main.datetime.timezone.utc)
        pet = {
            "name": "Mochi",
            "species": "rabbit",
            "created_by": "alice",
            "created_at": utc_now,
        }

        presented = main.present_shared_pet(pet, utc_now, timezone_offset_minutes=-420)

        self.assertTrue(presented["sleeping"])
        self.assertEqual(presented["activity"], "sleeping")

    async def test_shared_pet_care_actions_restore_the_matching_need(self):
        now = main.datetime.datetime(2026, 11, 7, 12, tzinfo=main.datetime.timezone.utc)
        pet = {
            "hunger": 40,
            "energy": 60,
            "happiness": 50,
            "cleanliness": 30,
            "created_at": now,
            "last_updated": now,
        }

        fed = main.apply_shared_pet_action(pet, "feed", now, 0)
        groomed = main.apply_shared_pet_action(pet, "groom", now, 0)

        self.assertEqual(fed["hunger"], 85)
        self.assertEqual(groomed["cleanliness"], 65)

    async def test_shared_pet_is_created_once_for_a_private_room(self):
        created = {}

        class Pets:
            async def update_one(self, query, update, upsert):
                self.asserted = (query, update, upsert)
                created.update(update["$setOnInsert"])

            async def find_one(self, query):
                return created

        with (
            patch.object(main, "require_world_room", new=AsyncMock(return_value="chat_alice_bob")),
            patch.object(main, "world_pet_collection", Pets()),
            patch.object(main, "manager", type(
                "Manager", (), {"broadcast_to_room": AsyncMock()}
            )()),
        ):
            result = await main.create_shared_pet(
                "bob",
                main.SharedPetCreateSchema(name="Mochi", species="rabbit"),
                "alice",
            )

        self.assertEqual(result["pet"]["name"], "Mochi")
        self.assertEqual(created["room"], "chat_alice_bob")
        self.assertEqual(created["experience"], 0)

    async def test_shared_pet_action_updates_shared_progress_and_enforces_cooldown(self):
        updated = {
            "name": "Mochi",
            "species": "rabbit",
            "created_by": "alice",
            "created_at": main.datetime.datetime.now(main.datetime.timezone.utc),
            "last_updated": main.datetime.datetime.now(main.datetime.timezone.utc),
            "experience": 8,
            "affection": 1,
            "interactions": 1,
            "last_action": "play",
            "hunger": 80,
            "energy": 60,
            "happiness": 75,
            "cleanliness": 90,
        }
        calls = 0
        read_calls = 0
        now = main.datetime.datetime.now(main.datetime.timezone.utc)
        account_key = main.hashlib.sha256(b"alice").hexdigest()

        class Pets:
            async def find_one_and_update(self, query, update, return_document):
                nonlocal calls
                calls += 1
                self.query = query
                self.update = update
                return updated if calls == 1 else None

            async def find_one(self, query, projection=None):
                nonlocal read_calls
                read_calls += 1
                if read_calls == 1:
                    return {
                        "room": "chat_alice_bob",
                        "created_at": now - main.datetime.timedelta(hours=1),
                        "last_updated": now - main.datetime.timedelta(hours=1),
                        "hunger": 80,
                        "energy": 60,
                        "happiness": 75,
                        "cleanliness": 90,
                    }
                return {"last_actions": {account_key: now}}

        with (
            patch.object(main, "require_world_room", new=AsyncMock(return_value="chat_alice_bob")),
            patch.object(main, "world_pet_collection", Pets()),
            patch.object(main, "manager", type(
                "Manager", (), {"broadcast_to_room": AsyncMock()}
            )()),
        ):
            pets = main.world_pet_collection
            result = await main.interact_with_shared_pet(
                "bob", main.SharedPetActionSchema(action="play"), "alice"
            )
            with self.assertRaises(HTTPException) as cooldown:
                await main.interact_with_shared_pet(
                    "bob", main.SharedPetActionSchema(action="feed"), "alice"
                )

        self.assertEqual(result["pet"]["experience"], 8)
        self.assertEqual(result["pet"]["affection"], 1)
        self.assertEqual(cooldown.exception.status_code, 429)
        cooldown_filters = pets.query["$and"][1]["$or"]
        self.assertTrue(any(
            "last_actions." in key
            for condition in cooldown_filters
            for key in condition
        ))

    async def test_shared_pet_cannot_be_woken_for_play_or_feeding(self):
        now = main.datetime.datetime.now(main.datetime.timezone.utc)

        class Pets:
            async def find_one(self, query, projection=None):
                return {
                    "room": "chat_alice_bob",
                    "created_at": now,
                    "last_updated": now,
                    "timezone_offset_minutes": -480,
                    "hunger": 80,
                    "energy": 90,
                    "happiness": 80,
                    "cleanliness": 90,
                }

            async def find_one_and_update(self, query, update, return_document):
                raise AssertionError("A sleeping pet must not be updated by disruptive actions.")

        with (
            patch.object(main, "require_world_room", new=AsyncMock(return_value="chat_alice_bob")),
            patch.object(main, "world_pet_collection", Pets()),
        ):
            with self.assertRaises(HTTPException) as sleeping:
                await main.interact_with_shared_pet(
                    "bob",
                    main.SharedPetActionSchema(action="play"),
                    "alice",
                )

        self.assertEqual(sleeping.exception.status_code, 409)

    async def test_completed_game_is_recorded_once_for_the_pair(self):
        class Games:
            def __init__(self):
                self.documents = {}

            async def insert_one(self, document):
                if document["_id"] in self.documents:
                    from pymongo.errors import DuplicateKeyError

                    raise DuplicateKeyError("duplicate match")
                self.documents[document["_id"]] = document

        games = Games()
        with patch.object(main, "world_game_collection", games):
            await main.record_world_game("match-1", ("alice", "bob"))
            await main.record_world_game("match-1", ("alice", "bob"))

        self.assertEqual(len(games.documents), 1)
        self.assertEqual(games.documents["match-1"]["room"], "chat_alice_bob")


class PerspectiveTopicTests(unittest.TestCase):
    def test_perspective_schema_trims_and_rejects_blank_required_fields(self):
        topic = main.PerspectiveTopicSchema(
            title="  Work or study? ",
            situation="  A shared situation. ",
            initial_thought="  Unsure. ",
        )
        self.assertEqual(topic.title, "Work or study?")
        self.assertEqual(topic.situation, "A shared situation.")
        self.assertEqual(topic.initial_thought, "Unsure.")
        with self.assertRaises(ValidationError):
            main.PerspectiveTopicSchema(title="  ", situation="x", initial_thought="y")
        with self.assertRaises(ValidationError):
            main.PerspectiveResponseSchema(answer="  ")

    def test_assignments_cover_members_and_perspective_map_groups_explicit_inputs(self):
        members = ["alice", "bob", "carol"]
        roles = main.assign_perspective_roles(members)
        self.assertEqual(set(roles), set(members))
        self.assertRegex(main.perspective_response_key("alice.smith"), r"^[0-9a-f]{64}$")

        result = main.build_perspective_map(
            {
                "alice": {
                    "answer": "Ưu tiên việc học và mục tiêu dài hạn.",
                    "direction": "Tìm phương án dung hòa",
                },
                "bob": {
                    "answer": "Việc học cần được ưu tiên trong kế hoạch.",
                    "direction": "tìm phương án dung hòa",
                },
                "carol": {
                    "answer": "Cần cân nhắc chi phí và thu nhập.",
                    "direction": "Tiếp tục làm thêm",
                },
            },
            roles,
        )

        self.assertIn("học", [item["word"] for item in result["common_words"]])
        self.assertEqual(len(result["directions"]), 2)
        shared = next(item for item in result["directions"] if len(item["roles"]) == 2)
        self.assertEqual(len(shared["roles"]), 2)

    def test_active_topics_hide_other_members_responses_until_reveal(self):
        now = main.datetime.datetime.now(main.datetime.timezone.utc)
        topic = {
            "_id": "topic-1",
            "title": "Work or study?",
            "situation": "A shared situation.",
            "creator": "alice",
            "members": ["alice", "bob"],
            "roles": {
                "alice": {"name": "Student", "prompt": "Think as the student."},
                "bob": {"name": "Family", "prompt": "Think as family."},
            },
            "responses": {
                main.perspective_response_key("alice"): {
                    "answer": "Focus on studies.",
                    "assumption": "",
                    "direction": "",
                },
            },
            "initial_thought": "I am unsure.",
            "status": "active",
            "created_at": now,
        }

        for username in ("alice", "bob"):
            result = main.present_perspective_topic(topic, username)
            self.assertNotIn("perspectives", result)
            if username == "alice":
                self.assertEqual(result["initial_thought"], "I am unsure.")
                self.assertEqual(result["own_response"]["answer"], "Focus on studies.")
            else:
                self.assertNotIn("initial_thought", result)
                self.assertNotIn("own_response", result)

        topic["responses"][main.perspective_response_key("bob")] = {
            "answer": "Keep working.",
            "assumption": "",
            "direction": "",
        }
        topic["status"] = "revealed"
        result = main.present_perspective_topic(topic, "bob")
        self.assertEqual(result["initial_thought"], "I am unsure.")
        self.assertEqual(len(result["perspectives"]), 2)


class PerspectiveTopicApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_responses_stay_private_until_every_group_member_submits(self):
        class Cursor:
            def __init__(self, documents):
                self.documents = documents

            def sort(self, *_):
                return self

            def limit(self, *_):
                return self

            async def to_list(self, length):
                return self.documents[:length]

        class Topics:
            def __init__(self):
                self.documents = {}

            async def insert_one(self, topic):
                self.documents[topic["_id"]] = topic

            async def find_one(self, query):
                topic = self.documents.get(query["_id"])
                if topic and topic["room"] == query["room"]:
                    return topic
                return None

            def find(self, query):
                return Cursor([
                    topic for topic in self.documents.values()
                    if topic["room"] == query["room"]
                ])

            async def update_one(self, query, update):
                topic = await self.find_one(query)
                if not topic or topic["status"] != query.get("status", topic["status"]):
                    return type("UpdateResult", (), {"matched_count": 0})()
                for path, value in update["$set"].items():
                    if path.startswith("responses."):
                        topic["responses"][path.removeprefix("responses.")] = value
                    else:
                        topic[path] = value
                return type("UpdateResult", (), {"matched_count": 1})()

        class Groups:
            async def find_one(self, query):
                if query["_id"] == "group_demo" and query["members"] in {"alice.smith", "bob"}:
                    return {"_id": "group_demo", "members": ["alice.smith", "bob"]}
                return None

        class Database:
            def __getitem__(self, name):
                if name != "groups":
                    raise AssertionError(name)
                return Groups()

        topics = Topics()
        roles = {
            "alice.smith": {"name": "Student", "prompt": "Think as the student."},
            "bob": {"name": "Family", "prompt": "Think as family."},
        }
        with (
            patch.object(main, "database", Database()),
            patch.object(main, "perspective_topic_collection", topics),
            patch.object(main, "assign_perspective_roles", return_value=roles),
        ):
            created = await main.create_perspective_topic(
                "group_demo",
                main.PerspectiveTopicSchema(
                    title="Work or study?",
                    situation="A shared situation.",
                    initial_thought="I am unsure.",
                ),
                "alice.smith",
            )
            private_view = await main.get_perspective_topics("group_demo", "bob")
            self.assertEqual(private_view[0]["submitted_count"], 0)
            self.assertNotIn("initial_thought", private_view[0])

            first = await main.submit_perspective_response(
                "group_demo",
                created["id"],
                main.PerspectiveResponseSchema(answer="Focus on studies."),
                "alice.smith",
            )
            self.assertEqual(first["status"], "active")
            self.assertNotIn("perspectives", first)

            private_view = await main.get_perspective_topics("group_demo", "bob")
            self.assertEqual(private_view[0]["submitted_count"], 1)
            self.assertNotIn("perspectives", private_view[0])

            revealed = await main.submit_perspective_response(
                "group_demo",
                created["id"],
                main.PerspectiveResponseSchema(answer="Keep working."),
                "bob",
            )
            self.assertEqual(revealed["status"], "revealed")
            self.assertEqual(len(revealed["perspectives"]), 2)
            self.assertEqual(revealed["initial_thought"], "I am unsure.")


class GroupChatTests(unittest.IsolatedAsyncioTestCase):
    async def test_group_schema_normalizes_name_and_rejects_invalid_members(self):
        group = main.GroupCreateSchema(name="  Study group  ", members=["bob"])
        self.assertEqual(group.name, "Study group")
        with self.assertRaises(ValidationError):
            main.GroupCreateSchema(name="   ", members=["bob"])
        with self.assertRaises(ValidationError):
            main.GroupCreateSchema(name="Friends", members=["bad username"])

    async def test_group_membership_is_checked_against_group_document(self):
        class Groups:
            async def find_one(self, query, projection):
                return {"_id": query["_id"]} if query["members"] == "alice" else None

        class Database:
            def __getitem__(self, collection):
                self.assert_group_collection(collection)
                return Groups()

            @staticmethod
            def assert_group_collection(collection):
                if collection != "groups":
                    raise AssertionError(collection)

        with patch.object(main, "database", Database()):
            self.assertTrue(await main.is_room_member("group_123", "alice"))
            self.assertFalse(await main.is_room_member("group_123", "eve"))

    async def test_create_group_checks_registered_members_and_persists_group(self):
        inserted = []

        class Cursor:
            async def to_list(self, length):
                return [{"username": "alice"}, {"username": "bob"}]

        class Users:
            def find(self, query, projection):
                self.query = query
                return Cursor()

        class Groups:
            async def insert_one(self, document):
                inserted.append(document)

        class Database:
            def __getitem__(self, collection):
                if collection != "groups":
                    raise AssertionError(collection)
                return Groups()

        with patch.object(main, "user_collection", Users()), patch.object(main, "database", Database()):
            result = await main.create_group(
                main.GroupCreateSchema(name="Study group", members=["bob", "bob"]),
                "alice",
            )

        self.assertEqual(result["members"], ["bob", "alice"])
        self.assertEqual(len(inserted), 1)
        self.assertEqual(inserted[0]["name"], "Study group")

    async def test_create_group_rejects_unknown_accounts(self):
        class Cursor:
            async def to_list(self, length):
                return [{"username": "alice"}]

        class Users:
            def find(self, query, projection):
                return Cursor()

        with patch.object(main, "user_collection", Users()):
            with self.assertRaises(HTTPException) as error:
                await main.create_group(
                    main.GroupCreateSchema(name="Study group", members=["bob"]),
                    "alice",
                )
        self.assertEqual(error.exception.status_code, 400)

    async def test_group_websocket_persists_and_broadcasts_chat_messages(self):
        room = "group_123"
        token = main.create_access_token("alice")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [{"type": "chat", "content": "Hello group"}]
                self.accepted = False

            async def accept(self, subprotocol):
                self.accepted = subprotocol == "chat"

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Groups:
            async def find_one(self, query, projection):
                return {"_id": room} if query["members"] == "alice" else None

        class Database:
            def __getitem__(self, collection):
                if collection != "groups":
                    raise AssertionError(collection)
                return Groups()

        class Users:
            async def find_one(self, query, projection):
                return {"username": "alice"}

        class Messages:
            def __init__(self):
                self.inserted = []

            async def insert_one(self, message):
                self.inserted.append(message)
                return type("InsertResult", (), {"inserted_id": "message-1"})()

        socket = FakeSocket()
        messages = Messages()
        with (
            patch.object(main, "database", Database()),
            patch.object(main, "user_collection", Users()),
            patch.object(main, "message_collection", messages),
            patch.object(main, "manager", main.ConnectionManager()),
        ):
            await main.websocket_endpoint(socket, room, "alice")

        self.assertTrue(socket.accepted)
        self.assertEqual(messages.inserted[0]["room"], room)
        self.assertEqual(messages.inserted[0]["content"], "Hello group")
        self.assertTrue(any(event.get("content") == "Hello group" for event in socket.events))

    async def test_websocket_reactions_are_persisted_toggled_and_broadcast(self):
        room = "group_123"
        message_id = str(main.ObjectId())
        token = main.create_access_token("alice")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [
                    {"type": "reaction", "message_id": message_id, "emoji": "👍"},
                    {"type": "reaction", "message_id": message_id, "emoji": "👍"},
                ]

            async def accept(self, subprotocol):
                self.accepted = subprotocol == "chat"

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Groups:
            async def find_one(self, query, projection):
                return {"_id": room} if query["members"] == "alice" else None

        class Database:
            def __getitem__(self, collection):
                if collection != "groups":
                    raise AssertionError(collection)
                return Groups()

        class Users:
            async def find_one(self, query, projection):
                return {"username": "alice"}

        class Messages:
            def __init__(self):
                self.document = {
                    "_id": main.ObjectId(message_id),
                    "room": room,
                    "sender": "bob",
                    "content": "Hello",
                    "is_deleted": False,
                    "reactions": {},
                }

            async def find_one(self, query, projection=None):
                if query["_id"] == self.document["_id"] and query["room"] == room:
                    return self.document
                return None

            async def update_one(self, query, update):
                if query["_id"] != self.document["_id"]:
                    return type("UpdateResult", (), {"matched_count": 0})()
                for path, value in update.get("$set", {}).items():
                    key = path.removeprefix("reactions.")
                    self.document["reactions"][key] = value
                for path in update.get("$unset", {}):
                    self.document["reactions"].pop(path.removeprefix("reactions."), None)
                return type("UpdateResult", (), {"matched_count": 1})()

        socket = FakeSocket()
        messages = Messages()
        with (
            patch.object(main, "database", Database()),
            patch.object(main, "user_collection", Users()),
            patch.object(main, "message_collection", messages),
            patch.object(main, "manager", main.ConnectionManager()),
        ):
            await main.websocket_endpoint(socket, room, "alice")

        updates = [event for event in socket.events if event.get("type") == "reaction_update"]
        self.assertEqual(len(updates), 2)
        self.assertEqual(
            updates[0]["reactions"],
            [{"emoji": "👍", "count": 1, "users": ["alice"]}],
        )
        self.assertEqual(updates[1]["reactions"], [])
        self.assertEqual(messages.document["reactions"], {})


class UploadTests(unittest.IsolatedAsyncioTestCase):
    class FakeUpload:
        def __init__(self, content, content_type="image/png"):
            self.content = content
            self.content_type = content_type
            self.closed = False

        async def read(self, size):
            chunk, self.content = self.content[:size], self.content[size:]
            return chunk

        async def close(self):
            self.closed = True

    def request(self, headers=None):
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/upload",
            "headers": headers or [],
            "query_string": b"",
            "server": ("test", 8000),
            "client": ("test", 1234),
            "scheme": "http",
            "http_version": "1.1",
        })

    async def test_upload_saves_content_with_server_selected_extension(self):
        content = b"\x89PNG\r\n\x1a\nvalid"
        upload = self.FakeUpload(content)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, "UPLOAD_DIR", Path(directory)):
                response = await main.upload_file(self.request(), upload, "alice")
                saved_file = Path(directory) / Path(response["url"]).name
                self.assertEqual(saved_file.read_bytes(), content)
                self.assertTrue(saved_file.name.endswith(".png"))
        self.assertEqual(response["type"], "image")
        self.assertTrue(upload.closed)

    async def test_upload_rejects_spoofed_content_and_closes_file(self):
        upload = self.FakeUpload(b"not an image")
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, "UPLOAD_DIR", Path(directory)):
                with self.assertRaises(HTTPException) as error:
                    await main.upload_file(self.request(), upload, "alice")
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertEqual(error.exception.status_code, 400)
        self.assertTrue(upload.closed)

    async def test_upload_rejects_oversized_request_before_writing(self):
        upload = self.FakeUpload(b"")
        request = self.request([(b"content-length", str(main.MAX_UPLOAD_BYTES + 1024 * 1024 + 1).encode())])
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, "UPLOAD_DIR", Path(directory)):
                with self.assertRaises(HTTPException) as error:
                    await main.upload_file(request, upload, "alice")
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertEqual(error.exception.status_code, 413)
        self.assertTrue(upload.closed)

    async def test_upload_rejects_oversized_file_without_content_length(self):
        upload = self.FakeUpload(b"\x89PNG\r\n\x1a\n" + b"x" * 16)
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch.object(main, "UPLOAD_DIR", Path(directory)),
                patch.object(main, "MAX_UPLOAD_BYTES", 16),
            ):
                with self.assertRaises(HTTPException) as error:
                    await main.upload_file(self.request(), upload, "alice")
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertEqual(error.exception.status_code, 413)
        self.assertTrue(upload.closed)

    async def test_uploaded_media_requires_chat_membership(self):
        filename = f"{'a' * 32}.png"

        class Messages:
            async def find_one(self, query, projection):
                self.query = query
                return {"room": "group_123"}

        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / filename
            file_path.write_bytes(b"png")
            with (
                patch.object(main, "UPLOAD_DIR", Path(directory)),
                patch.object(main, "message_collection", Messages()),
                patch.object(main, "is_room_member", new=AsyncMock(return_value=False)),
            ):
                with self.assertRaises(HTTPException) as error:
                    await main.get_uploaded_file(filename, "outsider")
        self.assertEqual(error.exception.status_code, 404)

    async def test_uploaded_media_returns_private_no_store_response_for_member(self):
        filename = f"{'b' * 32}.png"

        class Messages:
            async def find_one(self, query, projection):
                return {"room": "group_123"}

        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / filename).write_bytes(b"png")
            with (
                patch.object(main, "UPLOAD_DIR", Path(directory)),
                patch.object(main, "message_collection", Messages()),
                patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            ):
                response = await main.get_uploaded_file(filename, "alice")
        self.assertEqual(response.media_type, "image/png")
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    async def test_api_routes_are_registered_before_frontend_fallback(self):
        route_names = [getattr(route, "name", "") for route in main.app.routes]
        frontend_mount = route_names.index("frontend")
        route_paths = [getattr(route, "path", "") for route in main.app.routes]
        self.assertLess(route_paths.index("/api/groups"), frontend_mount)
        self.assertLess(route_paths.index("/api/upload"), frontend_mount)
        self.assertLess(route_paths.index("/uploads/{filename}"), frontend_mount)


class SharedMusicTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_chat_forwards_valid_music_invites_without_persisting_them(self):
        token = main.create_access_token("alice")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [
                    {
                        "type": "music_sync",
                        "action": "invite",
                        "video_id": "abcdefghijk",
                        "playlist_id": "",
                        "title": "Shared video",
                        "position": 3.5,
                        "playback_state": "playing",
                    },
                    {
                        "type": "music_sync",
                        "action": "state",
                        "video_id": "bad",
                        "position": 0,
                        "playback_state": "playing",
                    },
                ]

            async def accept(self, subprotocol):
                pass

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Users:
            async def find_one(self, query, projection):
                return {"username": "alice"}

        socket = FakeSocket()
        with (
            patch.object(main, "user_collection", Users()),
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "manager", main.ConnectionManager()),
        ):
            await main.websocket_endpoint(socket, "chat_alice_bob", "alice")

        invitation = next(event for event in socket.events if event.get("type") == "music_sync")
        self.assertEqual(invitation["action"], "invite")
        self.assertEqual(invitation["sender"], "alice")
        self.assertEqual(invitation["video_id"], "abcdefghijk")
        self.assertEqual(invitation["position"], 3.5)
        self.assertTrue(any(event.get("type") == "error" for event in socket.events))

    async def test_private_chat_forwards_playback_state_and_rejects_invalid_timing(self):
        token = main.create_access_token("bob")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [
                    {
                        "type": "music_sync",
                        "action": "state",
                        "video_id": "abcdefghijk",
                        "playlist_id": "",
                        "title": "Shared video",
                        "position": 42,
                        "playback_state": "paused",
                    },
                    {
                        "type": "music_sync",
                        "action": "state",
                        "video_id": "abcdefghijk",
                        "playlist_id": "",
                        "title": "Shared video",
                        "position": float("inf"),
                        "playback_state": "playing",
                    },
                ]

            async def accept(self, subprotocol):
                pass

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Users:
            async def find_one(self, query, projection):
                return {"username": "bob"}

        socket = FakeSocket()
        with (
            patch.object(main, "user_collection", Users()),
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "manager", main.ConnectionManager()),
        ):
            await main.websocket_endpoint(socket, "chat_alice_bob", "bob")

        state = next(event for event in socket.events if event.get("type") == "music_sync")
        self.assertEqual(state["playback_state"], "paused")
        self.assertEqual(state["position"], 42)
        self.assertTrue(any(event.get("type") == "error" for event in socket.events))

    async def test_group_rooms_cannot_broadcast_shared_music(self):
        token = main.create_access_token("alice")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [{"type": "music_sync", "action": "invite"}]

            async def accept(self, subprotocol):
                pass

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Users:
            async def find_one(self, query, projection):
                return {"username": "alice"}

        class Groups:
            async def find_one(self, query, projection):
                return {"_id": query["_id"]}

        class Database:
            def __getitem__(self, collection):
                if collection != "groups":
                    raise AssertionError(collection)
                return Groups()

        socket = FakeSocket()
        with (
            patch.object(main, "database", Database()),
            patch.object(main, "user_collection", Users()),
            patch.object(main, "manager", main.ConnectionManager()),
        ):
            await main.websocket_endpoint(socket, "group_test", "alice")

        self.assertTrue(any(event.get("type") == "error" for event in socket.events))
        self.assertFalse(any(event.get("type") == "music_sync" for event in socket.events))


class WebRTCCallManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_call_participants_are_limited_and_signals_are_peer_scoped(self):
        sessions = main.WebRTCCallManager()
        call_id = "4f835e84-4f28-486f-a2ea-fbe5b23a192a"

        self.assertTrue(await sessions.start("group_room", call_id, "alice"))
        for username in ("bob", "carol", "david"):
            joined, _ = await sessions.join("group_room", call_id, username)
            self.assertTrue(joined)

        joined, participants = await sessions.join("group_room", call_id, "eve")
        self.assertFalse(joined)
        self.assertEqual(len(participants), 4)
        self.assertTrue(await sessions.can_signal("group_room", call_id, "alice", "bob"))
        self.assertFalse(await sessions.can_signal("group_room", call_id, "alice", "eve"))
        self.assertFalse(await sessions.can_signal("another_room", call_id, "alice", "bob"))

    async def test_call_session_closes_after_last_participant_leaves(self):
        sessions = main.WebRTCCallManager()
        call_id = "d378c706-7979-48b2-8484-f2684333f989"
        await sessions.start("chat_alice_bob", call_id, "alice")
        await sessions.join("chat_alice_bob", call_id, "bob")

        left, participants = await sessions.leave("chat_alice_bob", call_id, "alice")
        self.assertTrue(left)
        self.assertEqual(participants, ["bob"])
        self.assertTrue(await sessions.exists("chat_alice_bob", call_id))

        left, participants = await sessions.leave("chat_alice_bob", call_id, "bob")
        self.assertTrue(left)
        self.assertEqual(participants, [])
        self.assertFalse(await sessions.exists("chat_alice_bob", call_id))

    async def test_call_endpoint_rejects_signaling_to_nonparticipants(self):
        token = main.create_access_token("alice")

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self):
                self.events = []
                self.incoming = [
                    {
                        "type": "call_signal",
                        "action": "invite",
                        "call_id": "36f0651e-1ddb-4710-a938-c11a86b5ac4e",
                    },
                    {
                        "type": "call_signal",
                        "action": "offer",
                        "call_id": "36f0651e-1ddb-4710-a938-c11a86b5ac4e",
                        "target": "bob",
                        "description": {"type": "offer", "sdp": "v=0"},
                    },
                ]

            async def accept(self, subprotocol):
                pass

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Users:
            async def find_one(self, query, projection):
                return {"username": "alice"}

        socket = FakeSocket()
        with (
            patch.object(main, "user_collection", Users()),
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "manager", main.ConnectionManager()),
            patch.object(main, "call_manager", main.WebRTCCallManager()),
        ):
            await main.websocket_endpoint(socket, "chat_alice_bob", "alice")

        self.assertTrue(any(event.get("action") == "invite" for event in socket.events))
        self.assertTrue(any(event.get("type") == "error" for event in socket.events))
        self.assertFalse(any(event.get("action") == "offer" for event in socket.events))

    async def test_call_endpoint_relays_peer_offer_only_to_target(self):
        token = main.create_access_token("alice")
        call_id = "cf1e2563-6eb5-405b-a37b-c59c2cd0110b"

        class FakeSocket:
            headers = {"sec-websocket-protocol": f"bearer.{token}, chat"}

            def __init__(self, incoming=()):
                self.events = []
                self.incoming = list(incoming)

            async def accept(self, subprotocol):
                pass

            async def receive_json(self):
                if self.incoming:
                    return self.incoming.pop(0)
                raise main.WebSocketDisconnect()

            async def send_json(self, event):
                self.events.append(event)

            async def close(self, code, reason):
                self.close_code = code

        class Users:
            async def find_one(self, query, projection):
                return {"username": query.get("username", "alice")}

        room = "chat_alice_bob"
        manager = main.ConnectionManager()
        bob = FakeSocket()
        await manager.connect(room, "bob", bob)
        calls = main.WebRTCCallManager()
        await calls.start(room, call_id, "alice")
        await calls.join(room, call_id, "bob")
        alice = FakeSocket([{
            "type": "call_signal",
            "action": "offer",
            "call_id": call_id,
            "target": "bob",
            "description": {"type": "offer", "sdp": "v=0"},
        }])

        with (
            patch.object(main, "user_collection", Users()),
            patch.object(main, "is_room_member", new=AsyncMock(return_value=True)),
            patch.object(main, "manager", manager),
            patch.object(main, "call_manager", calls),
        ):
            await main.websocket_endpoint(alice, room, "alice")

        offers = [
            event for event in bob.events
            if event.get("type") == "call_signal" and event.get("action") == "offer"
        ]
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["sender"], "alice")
        self.assertEqual(offers[0]["target"], "bob")
        self.assertFalse(any(event.get("type") == "call_signal" for event in alice.events))


class FakeWebSocket:
    def __init__(self):
        self.events = []
        self.close_code = None

    async def send_json(self, event):
        self.events.append(event)

    async def close(self, code, reason):
        self.close_code = code


class TetrisMatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_waiting_players_are_matched_and_game_result_is_broadcast(self):
        manager = main.TetrisMatchManager()
        alice = FakeWebSocket()
        bob = FakeWebSocket()

        await manager.join("alice", alice)
        await manager.join("bob", bob)

        alice_match = next(event for event in alice.events if event["type"] == "matched")
        bob_match = next(event for event in bob.events if event["type"] == "matched")
        self.assertEqual(alice_match["opponent"], "bob")
        self.assertEqual(bob_match["opponent"], "alice")
        self.assertEqual(alice_match["game_id"], bob_match["game_id"])

        await manager.update_score("alice", alice, 120)
        self.assertEqual(bob.events[-1], {"type": "opponent_score", "score": 120})
        await manager.finish("alice", alice, 150)
        self.assertEqual(alice.events[-1]["result"], "lose")
        self.assertEqual(bob.events[-1]["result"], "win")
        self.assertEqual(alice.close_code, 4000)
        self.assertEqual(manager.player_matches, {})

    async def test_disconnecting_player_gives_opponent_a_win(self):
        manager = main.TetrisMatchManager()
        alice = FakeWebSocket()
        bob = FakeWebSocket()
        await manager.join("alice", alice)
        await manager.join("bob", bob)

        await manager.leave("alice", alice)

        self.assertEqual(bob.events[-1]["result"], "win")
        self.assertEqual(bob.events[-1]["reason"], "opponent_disconnected")
        self.assertEqual(bob.close_code, 4001)

    async def test_same_account_cannot_join_matchmaking_twice(self):
        manager = main.TetrisMatchManager()
        first = FakeWebSocket()
        duplicate = FakeWebSocket()
        await manager.join("alice", first)
        await manager.join("alice", duplicate)

        self.assertEqual(duplicate.events[0]["type"], "error")
        self.assertEqual(duplicate.close_code, 4409)
        self.assertEqual(len(manager.waiting), 1)


class QuickGameMatchTests(unittest.IsolatedAsyncioTestCase):
    async def make_match(self, manager, game):
        alice = FakeWebSocket()
        bob = FakeWebSocket()
        await manager.join(game, "alice", alice)
        await manager.join(game, "bob", bob)
        return alice, bob

    async def test_gomoku_alternates_turns_and_detects_five_in_a_row(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "gomoku")
        for column in range(5):
            await manager.handle("gomoku", "alice", alice, {"type": "move", "row": 0, "column": column})
            if column < 4:
                await manager.handle("gomoku", "bob", bob, {"type": "move", "row": 1, "column": column})
        alice_results = [event for event in alice.events if event["type"] == "result"]
        bob_results = [event for event in bob.events if event["type"] == "result"]
        self.assertEqual(alice_results[-1]["result"], "win")
        self.assertEqual(bob_results[-1]["result"], "lose")
        self.assertEqual(len(manager.matches), 0)

    async def test_rock_paper_scissors_hides_choice_until_both_choose(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "rps")
        await manager.handle("rps", "alice", alice, {"type": "choice", "choice": "rock"})
        self.assertFalse(any(event["type"] == "round_result" for event in alice.events))
        await manager.handle("rps", "bob", bob, {"type": "choice", "choice": "scissors"})
        self.assertEqual(
            [event for event in alice.events if event["type"] == "round_result"][-1]["round_winner"],
            "alice",
        )
        await manager.handle("rps", "alice", alice, {"type": "choice", "choice": "rock"})
        await manager.handle("rps", "bob", bob, {"type": "choice", "choice": "scissors"})
        self.assertEqual([event for event in alice.events if event["type"] == "result"][-1]["result"], "win")
        self.assertEqual([event for event in bob.events if event["type"] == "result"][-1]["result"], "lose")

    async def test_duel_early_reaction_loses_round_and_opponent_wins(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "duel")
        await manager.handle("duel", "alice", alice, {"type": "ready"})
        await manager.handle("duel", "bob", bob, {"type": "ready"})
        game_id = manager.player_matches[("duel", "alice")]
        task = manager.matches[game_id]["duel_task"]
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

        await manager.handle("duel", "alice", alice, {"type": "react"})

        self.assertEqual(
            [event for event in bob.events if event["type"] == "round_result"][-1]["winner"],
            "bob",
        )
        self.assertTrue(any(event["type"] == "ready_required" for event in alice.events))

    async def test_gomoku_rejects_out_of_turn_and_occupied_cell_moves(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "gomoku")
        await manager.handle("gomoku", "bob", bob, {"type": "move", "row": 0, "column": 0})
        self.assertEqual(bob.events[-1]["type"], "error")
        await manager.handle("gomoku", "alice", alice, {"type": "move", "row": 0, "column": 0})
        await manager.handle("gomoku", "bob", bob, {"type": "move", "row": 0, "column": 0})
        self.assertEqual(bob.events[-1]["type"], "error")
        self.assertEqual(manager.matches[manager.player_matches[("gomoku", "alice")]]["board"][0][0], "X")

    async def test_rock_paper_scissors_tied_round_does_not_award_a_point(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "rps")
        await manager.handle("rps", "alice", alice, {"type": "choice", "choice": "paper"})
        await manager.handle("rps", "bob", bob, {"type": "choice", "choice": "paper"})
        result = [event for event in alice.events if event["type"] == "round_result"][-1]
        self.assertIsNone(result["round_winner"])
        self.assertEqual(result["your_round_wins"], 0)
        self.assertEqual(result["opponent_round_wins"], 0)

    async def test_duel_reaction_wins_round_and_two_rounds_win_match(self):
        manager = main.QuickGameMatchManager()
        alice, bob = await self.make_match(manager, "duel")
        for _ in range(2):
            await manager.handle("duel", "alice", alice, {"type": "ready"})
            await manager.handle("duel", "bob", bob, {"type": "ready"})
            game_id = manager.player_matches[("duel", "alice")]
            task = manager.matches[game_id]["duel_task"]
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            manager.matches[game_id]["signal"] = True
            await manager.handle("duel", "bob", bob, {"type": "react"})
        self.assertEqual([event for event in bob.events if event["type"] == "result"][-1]["result"], "win")
        self.assertEqual([event for event in alice.events if event["type"] == "result"][-1]["result"], "lose")


if __name__ == "__main__":
    unittest.main()
