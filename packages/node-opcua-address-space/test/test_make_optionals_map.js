"use strict";

const should = require("should");

const makeOptionalsMap = require("../src/make_optionals_map").makeOptionalsMap;

describe("Testing makeOptionalsMap",function(){


    it("should create an optional map from a single string",function() {

        const map =makeOptionalsMap(["Hello"]);
        map.should.ownProperty("Hello");

    });
    it("should create an optional map from a single string",function() {

        const map =makeOptionalsMap(["Hello.World","Hello.Goodbye"]);
        map.should.ownProperty("Hello");
        map["Hello"].should.ownProperty("World");
        map["Hello"].should.ownProperty("Goodbye");
    });
});