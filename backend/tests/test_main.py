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
