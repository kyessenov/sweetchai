Songs = new Mongo.Collection("songs");
Queue = new Mongo.Collection("queue");
Albums = new Mongo.Collection("albums");
Artists = new Mongo.Collection("artists");

Router.route('/song/:id', function() {
  var id = this.params.id;
  var song = Songs.findOne({_id: id});
  if (typeof(song) !== 'undefined') {
    var fs = Meteor.npmRequire('fs');
    var stat = fs.statSync(song.file);
    this.response.writeHead(200, {
      'Content-type': 'audio/mpeg3', 
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size
    });
    fs.createReadStream(song.file).pipe(this.response);
  } else {
    this.response.writeHead(404);
    this.response.end();
  }
}, { where: 'server' });

Router.route('/', function() { 
  this.render('home');
});

if (Meteor.isClient) {
  Meteor.startup(function () { Session.set("initial", Session.get("t"));});

  var audio = document.createElement("audio");
  Meteor.audio = audio;
  audio.preload = 'none';
  audio.autoplay = true;
  audio.volume = 1;
  audio.ontimeupdate = function () { Session.setPersistent("t", audio.currentTime); };
  audio.ondurationchange = function () { Session.setPersistent("duration", audio.duration); };
  audio.onended = function () { 
    Queue.remove(Queue.findOne({t: Session.get("tid")})._id);
    audio.nextSong() 
  };
  audio.playSong = function (q) {
    if (q !== undefined) {
      Session.set("initial", -Math.random());
      Session.setPersistent("tid", q.t);
      Session.setPersistent("qid", q._id);
      Session.setPersistent("id", q.song._id);
    } 
  };
  audio.prevSong = function () {
    audio.playSong(Queue.findOne({t: {$lt: Session.get("tid")} }, { sort: {t: -1}}))
  };
  audio.nextSong = function () { 
    audio.playSong(Queue.findOne({t: {$gt: Session.get("tid")} }, { sort: {t: 1} })) 
  };
  audio.stopSong = function () {
    Session.setPersistent("tid", -1);
    Session.setPersistent("qid", -1);
    Session.setPersistent("id", 0);
  };
  var enqueue = function (song) { 
    var last = Queue.findOne({}, {sort:{t: -1}});
    Queue.insert({song: song, t: last === undefined ? 1 : last.t + 1 }); 
  };

  Queue.find({}).observeChanges({
    removed: function (id) { if (id === Session.get("qid")) { audio.stopSong(); audio.nextSong() }}
  });
  Template.library.helpers({
    count: function () { return Songs.find({}).count() },
    albums: function () { return Albums.find({}, { sort: ["album"]}) }
  });
  Template.library.events({
    'click .update': function () { Meteor.call("update"); },
    'click .random': function () { Meteor.call("random", function (e, s) { enqueue(s) }); }
  });
  Template.queue.helpers({
    count: function () { return Queue.find({}).count() },
    qsongs: function () { return Queue.find({}, {sort: ["tid"]}) }
  });
  Template.queue.events({
    'click .clear': function () { Meteor.call("clear"); },
    'click .shuffle': function () { audio.stopSong(); Meteor.call("shuffle"); }
  });
  Template.player.helpers({
    current: function () { 
      var out = Queue.findOne({t: Session.get("tid")});
      if (out !== undefined) {
        audio.src = '/song/'+out.song._id;
        var initial = Session.get("initial");
        audio.oncanplay = function () {
          audio.currentTime = initial > 0 ? initial : 0; 
          delete audio.oncanplay;
        };
        audio.currentTime = 0;
        audio.play();
        return out.song;
      } else {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
        return undefined;
      } 
    },
    timer: function () { return buzz.toTimer(Session.get("t")) },
    duration: function () { return buzz.toTimer(Session.get("duration")) }
  });
  Template.player.events({
    'click .toggle': function () { if (audio.paused) { audio.play() } else { audio.pause() } },
    'click .next': function () { audio.nextSong() },
    'click .prev': function () { audio.prevSong() },
    'click .current': function () { $('body, html').scrollTop($('#'+ Session.get("id")).offset().top - 50) }
  });
  Template.album.helpers({
    nonempty: function () { return Artists.find({album: this.album}).count() > 0 },
    artists: function () { return Artists.find({album: this.album}, {sort: ["artist"]}); },
    songs: function () { return Songs.find({album: this.album}, {sort: ["track"]}) }
  });
  Template.album.events({
    'click .play': function () { Songs.find({album: this.album}, {sort: ["track"]}).forEach(enqueue) }
  });
  Template.artist.events({
    'click': function () { Songs.find({artist: this.artist}, {sort: ["album", "track"]}).forEach(enqueue) } });
  Template.song.helpers({
    playing: function () { return this._id === Session.get("id") } 
  });
  Template.song.events({
    'click': function () { enqueue(this) }
  });
  Template.qsong.helpers({
    playing: function () { return this._id === Session.get("qid") }
  });
  Template.qsong.events({
    'click .title': function () { audio.playSong(this) },
    'click .remove': function () { Queue.remove(this._id) }
  });
}

if (Meteor.isServer) {
  Meteor.methods({
    update: function() {
      Songs.remove({});
      Albums.remove({});
      Artists.remove({});
      Queue.remove({});
      var taglib = Meteor.npmRequire("taglib");
      var glob = Meteor.npmRequire("glob");
      var files = glob.sync(process.env.HOME+"/Music/**/*.mp3");
      var count = 0;
      files.forEach(function (file) {
        var song = taglib.tagSync(file);
        var album = { "album": song.album };
        var artist = { "artist": song.artist, "album": song.album };
        song.file = file;
        Songs.insert(song);
        if (Albums.find(album).count() === 0) Albums.insert(album);
        if (Artists.find(artist).count() === 0) Artists.insert(artist);
      });
    },
    clear: function () {
      Queue.remove({});
    },
    random: function() {
      var n = Songs.find({}).count();
      var r = Math.floor(Math.random() * n);
      return Songs.find({}, { limit: 1, skip: r}).fetch()[0];
    },
    shuffle: function () {
      var ks = Meteor.npmRequire('knuth-shuffle').knuthShuffle;
      var prev = Queue.find({}, {sort: {t: 1}}).fetch().map(function (elt) { return elt.song });
      var next = ks(prev);
      Queue.remove({});
      next.forEach(function (elt, i) { Queue.insert({t: i, song: elt}) });
    }
  });
}
