// Copyright 2017 Abhishek Kulkarni

import * as $ from "jquery";
import "bootstrap";

import ReconnectingWebSocket = require("reconnecting-websocket");
import anchorme from "anchorme";
import ChessBoard from "chessboardjs";
import Chess from "chess.js";

// A FICS session
var session = {
  connected: false,
  handle: '',
  ws: null
}

// List of active tabs
var tabs;

// An online chess game
var game = {
  chess: null,
  premove: null,
  color: '',
  bclock: null,
  wclock: null,
  btime: 0,
  wtime: 0,
  history: null
}

// Type of messages we receive from the proxy
var msgType = {
  ctl: 0,
  chTell: 1,
  pTell: 2,
  gameMove: 3,
  gameStart: 4,
  gameEnd: 5,
  unknown: 6
};

/**
 * Highlight an arbitrary square (to show possible moves or the last move)
 * @param square Square to highlight
 */
function highlightSquare(square: string): void {
  if (square === undefined) {
    return;
  }
  var e = $('#board .square-' + square);
  if (e.hasClass('black-3c85d')) {
    e.css('background', '#278881');
  } else {
    e.css('background', '#e6ffdd');
  }
};

/**
 * Remove highlights from a square or all squares on the board.
 * @param square Square to unhighlight
 */
function unHighlightSquare(square?: string): void {
  if (square !== undefined) {
    $('#board .square-' + square).css('background', '');
  } else {
    $('#board .square-55d63').css('background', '');
  }
}

/**
 * Highlight a square to show an active check.
 * @param square Square to highlight
 */
function highlightCheck(square: string): void {
  if (square === undefined) {
    return;
  }
  var e = $('#board .square-' + square);
  if (e.hasClass('black-3c85d')) {
    e.css('background', '#aa8881');
  } else {
    e.css('background', '#ffdddd');
  }
};

/**
 * Highlight a move. This is used to provide a visual cue to display the 
 * previous move on the board.
 * @param source The source square to highlight
 * @param target The target square to highlight
 */
function highlightMove(source: string, target: string): void {
  unHighlightSquare();
  highlightSquare(source);
  highlightSquare(target);
}

/**
 * Highlight a premove. Premoves are highlighted with a different color than the last played move.
 * @param source The source square to highlight
 * @param target The target square to highlight
 */
function highlightPreMove(source: string, target: string): void {
  highlightCheck(source);
  highlightCheck(target);
}

/**
 * Show captured piece.
 * @param color 
 * @param captured 
 */
function showCapture(color, captured) {
  if (typeof captured !== 'undefined') {
    if (color === game.color) {
      $('#opponent-captured').append(captured);
    } else {
      $('#player-captured').append(captured);
    }
  }
}

function swapColor(color: string): string {
  return color === 'w' ? 'b' : 'w';
}

function showCheck(color, san) {
  if (san.slice(-1) === '+') {
    var sq = $("div").find("[data-piece='" + swapColor(color) + "K']");
    highlightCheck(sq.parent().data('square'));
  }
}

function SToHHMMSS(sec) {
  var h = Math.floor(sec / 3600);
  var m = Math.floor(sec % 3600 / 60);
  var s = Math.floor(sec % 3600 % 60);
  return ((h > 0 ? (h >= 0 && h < 10 ? '0' : '') + h + ':' : '') + (m >= 0 && m < 10 ? '0' : '') + m + ':' + (s >= 0 && s < 10 ? '0' : '') + s);
}

var startBclock = function(clock) {
  return setInterval(function() {
    if (game.chess.turn() === 'w') {
      return;
    }

    game.btime = game.btime - 1;
    if (game.btime < 20 && clock.css('color') !== 'red') {
      clock.css('color', 'red');
    }

    if (game.btime > 20) {
      clock.css('color', '');
    }

    clock.text(SToHHMMSS(game.btime));
  }, 1000);
}

var startWclock = function(clock) {
  return setInterval(function() {
    if (game.chess.turn() === 'b') {
      return;
    }

    game.wtime = game.wtime - 1;
    if (game.wtime < 20 && clock.css('color') !== 'red') {
      clock.css('color', 'red');
    }

    if (game.wtime > 20) {
      clock.css('color', '');
    }

    clock.text(SToHHMMSS(game.wtime));
  }, 1000);
}

var onDragStart = function(source, piece, position, orientation) {
  var chess = game.chess;
  if (chess === null) {
    return false;
  }

  if (chess.game_over() == true ||
      (game.color !== piece.charAt(0))) {
    return false;
  }

  if (game.premove !== null) {
    unHighlightSquare(game.premove.source);
    unHighlightSquare(game.premove.target);
    game.premove = null;
  }

  // get list of possible moves for this square
  var moves = chess.moves({square: source, verbose: true});
  highlightSquare(source);
  for (var i = 0; i < moves.length; i++) {
    highlightSquare(moves[i].to);
  }
};

function movePlayer(source, target) {
  var chess = game.chess;
  // see if the move is legal
  var move = chess.move({
    from: source,
    to: target,
    promotion: 'q' // TODO: Allow non-queen promotes
  });

  // illegal move
  if (move === null) {
    unHighlightSquare();
    return 'snapback';
  }

  session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: source+"-"+target }));
  highlightMove(move.from, move.to);
  showCapture(move.color, move.captured);
  showCheck(move.color, move.san);
}

var onDrop = function(source, target) {
  // premove if it is not my turn yet
  if (game.color !== game.chess.turn()) {
    game.premove = {source: source, target: target};
    return highlightPreMove(source, target);
  } else {
    return movePlayer(source, target);
  }
};

// update the board position after the piece snap
// for castling, en passant, pawn promotion
var onSnapEnd = function() {
  board.position(game.chess.fen());
};

// Chess board
var board: any = ChessBoard('board', {
  position: 'start',
  showNotation: true,
  draggable: true,
  onDragStart: onDragStart,
  onDrop: onDrop,
  onSnapEnd: onSnapEnd,
  pieceTheme: 'assets/img/chesspieces/wikipedia-svg/{piece}.svg'
});

// enable tooltips
$(function () {
  $('[data-toggle="tooltip"]').tooltip()
})

// Allow chat card to be collapsed
$('#collapse-chat').on('hidden.bs.collapse', function () {
  $('#chat-toggle-icon').removeClass('fa-toggle-up').addClass('fa-toggle-down');
})
$('#collapse-chat').on('show.bs.collapse', function () {
  $('#chat-toggle-icon').removeClass('fa-toggle-down').addClass('fa-toggle-up');
})

jQuery(document.body).on('click', '.closeTab', function(event) {
  var tabContentId = $(this).parent().attr("href");
  $(this).parent().remove();
  delete tabs['content-'+tabContentId.substr(1)];
  $('#tabs a:last').tab('show');
  $(tabContentId).remove();
});

$(document).on('shown.bs.tab', 'a[data-toggle="tab"]', function (e) {
  var tab = $(e.target);
  tab.css('color', 'black');
});

function handleChatMsg(from, data) {
  var tab;
  if (!tabs.hasOwnProperty(from)) {
    var chName = from;
    if (from === '4') {
      chName = "Help";
    }
    $('<a class="flex-sm-fill text-sm-center nav-link" data-toggle="tab" href="#content-'+from+'" id="'+from+'" role="tab">'+chName+'<span class="btn btn-default btn-sm closeTab">×</span></a>').appendTo('#tabs');
    $('<div class="tab-pane chat-text" id="content-'+from+'" role="tabpanel"></div>').appendTo('.tab-content');
    $(".chat-text").height($("#board").height()-40);
    tab = $("#content-"+from);
    tabs[from] = tab;
  } else {
    tab = tabs[from];
  }

  var who = "";
  var tabheader = $("#" + $("ul#tabs a.active").attr("id"));
  if (data.hasOwnProperty('handle')) {
    var textclass = "";
    if (session.handle == data.handle) {
      textclass = " class=\"mine\"";
    }
    who = "<strong"+textclass+">"+$('<span/>').text(data.handle).html()+"</strong>: ";
    if (data.type == msgType.chTell) {
      tabheader = $("#"+data.channel);
    } else {
      tabheader = $("#"+data.handle);
    }
  }
  tab.append(who +
    anchorme($('<span/>').text(data.text).html(), {attributes:[{name:"target",value:"_blank"}]})+"</br>");

  if (tabheader.hasClass('active')) {
    tab.scrollTop(tab[0].scrollHeight);
  } else {
    tabheader.css('color', 'red');
  }
}

function handleICSMsg(message) {
  var data = JSON.parse(message.data);
  switch(data.type) {
    case msgType.ctl:
      if (session.connected == false && data.command == 1) {
        session.connected = true;
        session.handle = data.text;
        $("#chat-status").text("Connected as " + session.handle);
      }
      break;
    case msgType.chTell:
      handleChatMsg(data.channel, data)
      break;
    case msgType.pTell:
      handleChatMsg(data.handle, data);
      break;
    case msgType.gameMove:
      game.btime = data.btime;
      game.wtime = data.wtime;

      // role 1: I am playing and it is my move
      // role -1: I am playing and it is my opponent's move
      if (game.chess === null) {
        game.chess = Chess();
        board.start(false);
        game.history = {moves: [], chess: null, id: -1};
        $('#player-captured').text("");
        $('#opponent-captured').text("");
        if (data.role == 1) {
          game.color = 'w';
          board.orientation('white');
          game.wclock = startWclock($("#player-time"));
          game.bclock = startBclock($("#opponent-time"));
          $("#player-name").text(data.wname);
          $("#opponent-name").text(data.bname);
        } else if (data.role == -1) {
          game.color = 'b';
          board.orientation('black');
          game.bclock = startBclock($("#player-time"));
          game.wclock = startWclock($("#opponent-time"));
          $("#player-name").text(data.bname);
          $("#opponent-name").text(data.wname);
        }
      }

      if (data.role == 1) {
        if (data.move !== "none") {
          var move = game.chess.move(data.move);
          if (move !== null) {
            highlightMove(move.from, move.to);
            showCapture(move.color, move.captured);
            showCheck(move.color, move.san);
          }
          if (game.premove !== null) {
            movePlayer(game.premove.source, game.premove.target);
            game.premove = null;
          }
        }
      }
      board.position(data.fen);
      break;
    case msgType.gameStart:
      break;
    case msgType.gameEnd:
      clearInterval(game.wclock);
      clearInterval(game.bclock);
      displayHistory();
      delete game.chess;
      game.chess = null;
      break;
    case msgType.unknown:
    default:
      handleChatMsg($("ul#tabs a.active").attr("id"), data);
      break;
  }
}

function disconnectICS() {
  $("#chat-status").text("Disconnected");
  session.connected = false;
  session.handle = "";
};

function connectToICS(user?: string, pass?: string) {
  var login = (typeof user !== 'undefined' && typeof pass !== 'undefined');
  var loginOptions = "";
  if (login) {
    loginOptions += "?login=1"
  }
  var conn = new ReconnectingWebSocket(location.protocol.replace("http","ws") + "//" + location.host + "/ws" + loginOptions)
  conn.onmessage = handleICSMsg;
  conn.onclose = disconnectICS;
  if (login) {
    conn.onopen = function() {
      conn.send(JSON.stringify({ type: msgType.ctl, command: 1, text: "[" + user + "," + btoa(pass) + "]" }));
    }
  }
  return conn;
}

$("#input-form").on("submit", function(event) {
  event.preventDefault();
  var text;
  if (!$("#input-command").is(':checked')) {
    if ($("#input-text").val().charAt(0) != "@") {
      var msg = $("#input-text").val();
      var tab = $("ul#tabs a.active").attr("id")
      text = "t " + tab + " " + msg;
      handleChatMsg(tab, { type: msgType.chTell, channel: tab, handle: session.handle, text: msg });
    } else {
      text = $("#input-text").val().substr(1);
    }
  } else {
    if ($("#input-text").val().charAt(0) != "@") {
      text = $("#input-text").val();
    } else {
      text = $("#input-text").val().substr(1);
    }
  }
  session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: text }));
  $("#input-text").val("");
});

$(document).ready(function() {
  session.ws = connectToICS();
  session.connected = false;
  $("#chat-status").text("Connecting...");
  $("#opponent-time").text("00:00");
  $("#player-time").text("00:00");
  $(".chat-text").height($("#board").height()-40);
  tabs = { "53": $("#content-53") };
  board.start(false);
  game.history = {moves: [], chess: null, id: -1};
});

function displayHistory() {
  if (game.history.chess === null) {
    game.history.chess = Chess();
  }

  // refresh history
  if (game.chess !== null) {
    var moves = game.chess.history();
    if (game.history.moves.length < moves.length) {
      for (var i = game.history.moves.length-1; i < moves.length; i++) {
        game.history.chess.move(moves[i]);
        game.history.moves.push(game.history.chess.fen());
      }
    }
  }

  if (game.history.id < 0) {
    game.history.id = game.history.moves.length-1;
  }

  board.position(game.history.moves[game.history.id]);
}

$("#fast-backward").on("click", function(event) {
  game.history.id = 0;
  displayHistory();
});

$("#backward").on("click", function(event) {
  if (game.history.id > 0) {
    game.history.id = game.history.id-1;
  }
  displayHistory();
});

$("#forward").on("click", function(event) {
  if (game.history.id < game.history.moves.length-1) {
    game.history.id = game.history.id+1;
  }
  displayHistory();
});

$("#fast-forward").on("click", function(event) {
  game.history.id = game.history.moves.length-1;
  displayHistory();
});

$("#resign").on("click", function(event) {
  if (game.chess !== null && session.ws !== null) {
    session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: "resign" }));
  }
});

$("#abort").on("click", function(event) {
  if (game.chess !== null && session.ws !== null) {
    session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: "abort" }));
  }
});

$("#takeback").on("click", function(event) {
  if (game.chess !== null && session.ws !== null) {
    if (game.chess.turn() === game.color) {
      session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: "take 2"}));
    } else {
      session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: "take 1"}));
    }
  }
});

$("#draw").on("click", function(event) {
  if (game.chess !== null && session.ws !== null) {
    session.ws.send(JSON.stringify({ type: msgType.ctl, command: 0, text: "draw" }));
  }
});

$("#disconnect").on("click", function(event) {
  $("#chat-status").text("Disconnecting...");
  session.ws.close();
});

$("#login").on("click", function(event) {
  $("#chat-status").text("Connecting...");
  var user = $("#login-user").val();
  var pass = $("#login-pass").val();
  session.ws = connectToICS(user, pass);
  $("#login-screen").modal("hide");
});

$("#connect-user").on("click", function(event) {
  if (session.connected !== true) {
    $("#login-screen").modal("show");
  }
});

$("#connect-guest").on("click", function(event) {
  if (session.connected !== true) {
    $("#chat-status").text("Connecting...");
    session.ws = connectToICS();
  }
});

$(window).focus(function() {
  if (game.chess !== null) {
    board.position(game.chess.fen(), false);
  }
});

$(window).resize(function() {
  board.resize();
  $(".chat-text").height($("#board").height()-40);
});