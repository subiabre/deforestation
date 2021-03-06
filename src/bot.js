const 
    Country = require('./service/country'),
    Memory = require('./model/memory'),
    Log = require('./model/log'),
    Twitter = require('twitter'),
    GLAD = require('./service/glad'),
    Mapper = require('./service/mapper'),
    fs = require('fs')
    ;

/**
 * A bot to help visualize forest loss accross the globe.
 * In loving memory of my friend @wishiwasrubin
 * 
 * @author Facundo Subiabre (subiabre at gmail dot com)
 * @license MIT
 * @version 2.2
 * @repository https://gitlab.com/subiabre/deforestation
 */
class Bot
{
    /**
     * Deforestation bot.
     * 
     * A bot to help visualize forest loss accross the globe.
     */
    constructor()
    {
        this.loadEnv();

        this.loadServices();
    }

    /**
     * Sends (or not) a message to `console.log()`
     * @param {string} message Message to be displayed 
     */
    console(message)
    {
        this.consoleLog.push({
            message: message,
            date: new Date()
        });

        if (this.env.logging) {
            console.log(this.consoleLog[this.consoleLog.length - 1]);
        }
    }

    async consoleSave(filename)
    {
        return await fs.writeFileSync(filename, JSON.stringify(this.consoleLog, null, 2));
    }

    /**
     * Obtain the bot routine log
     * @return {JSON}
     */
    getLog()
    {
        return {
            "status": {
                "date": new Date(),
                "log": this.consoleLog,
            }
        }
    }

    /**
     * Loads environment settings
     */
    loadEnv()
    {
        var dotenv = require('dotenv');
        dotenv.config({
            path: __dirname + '/../.env'
        });

        // Store env vars
        this.env = {
            twitter: {
                on: process.env.TWITTER == 'true' ? true : false,
                consumerKey: process.env.TWITTER_CONSUMER_KEY,
                consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
                accessTokenKey: process.env.TWITTER_ACCESS_TOKEN_KEY,
                accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
            },

            database: process.env.DATABASE == 'true' ? true : false,
            databaseUrl: process.env.DATABASE_URL,

            logging: process.env.LOGGING,
            loggingGlad: process.env.LOGGING_GLAD,

            delay: process.env.DELAY_MS || 400,
            delayDays: process.env.DELAY_DAYS || 7,

            grassColor: process.env.GRASS_COLOR,
            deforestatedColor: process.env.DEFORESTATED_COLOR,
            deforestatedColorPrevious: process.env.DEFORESTATED_COLOR_OLD
        }

        // Start empty log
        this.consoleLog = new Array();

        this.console('BOT ENVIRONMENT SETUP');
    }

    /**
     * Loads bot services
     */
    loadServices()
    {
        if (this.env.database) {
            this.mongoose = require('mongoose');
            this.mongoose.connect(
                this.env.databaseUrl,
                {
                    useNewUrlParser: true,
                    useUnifiedTopology: true
                }
            ).catch(error => {
                this.console(error);
                return;
            });
        }
        
        this.twitter = new Twitter({
            consumer_key: this.env.twitter.consumerKey,
            consumer_secret: this.env.twitter.consumerSecret,
            access_token_key: this.env.twitter.accessTokenKey,
            access_token_secret: this.env.twitter.accessTokenSecret
        });

        this.http = require('http');

        this.countries = require('country-list');
    
        /**
         * Countries list
         */
        let fileList = fs.readFileSync(__dirname + '/list.json');
        this.list = JSON.parse(fileList);

        /**
         * GLAD service internal instance
         */
        this.glad = new GLAD();

        this.glad.logging = this.env.loggingGlad;

        /**
         * Mapper service internal instance
         */
        this.map = new Mapper();

        this.console('BOT SERVICES SETUP');
    }

    /**
     * Runs the sequence routine of the bot
     */
    async routine()
    {
        this.console('BOT ROUTINE STARTED.');

        if (!this.env.database) {
            this.console('DATABASE IS REQUIRED TO INIT THE ROUTINE.');
            
            return 1;
        }
        
        // Fetch memory
        let memory = await this.getMemory();
        this.console('MEMORY READ: OK.');

        // Prepare GLAD period
        let gladDate = new Date().setDate(new Date().getDate() - this.env.delayDays),
            gladDateString = this.toLocaleDateString(gladDate);

        // Fetch GLAD
        this.console('FETCHING FROM GLAD API.');
        this.console(`DATE IS: ${gladDateString}`);
        
        let gladPeriod = this.glad.formatPeriod(gladDate, gladDate),
            gladResponse = await this.glad.getAlerts(gladPeriod, this.env.delay),
            gladLog = gladResponse.log,
            gladArea = gladResponse.area,
            gladAreaString = this.toLocaleAreaString(gladArea);
        this.console(`AREA IS: ${gladArea}`);

        // Save log of GLAD fetch
        let newLog = new Log({
            gladStart: gladDate,
            gladEnd: gladDate,
            gladLog: gladLog
        });

        await newLog.save();

        // Exit on no deforestated area for this period
        if (gladArea < 1) {
            this.console('NO NEW DEFORESTATION. EXITING ROUTINE.');

            return 0;
        }

        // Fetch countries
        let countryList = this.list[memory.country],
            country = await new Country(countryList.code).getByCode();
        this.console(`COUNTRY IS: ${countryList.name}.`);

        // Calc aggregated area of deforestation
        let totalArea = gladArea + memory.area,
            totalAreaString = this.toLocaleAreaString(totalArea);

        // Calc difference between country forestal area and new deforestated area
        let remainingArea = countryList.area - totalArea,
            remainingAreaString = this.toLocaleAreaString(remainingArea);

        // Calc total deforestated area in comparison to country forest area
        let ratioTotal = memory.area * 100 / countryList.area,
            deforestationArea = ratioTotal * country.data.area / 100;
        
        // Calc new deforestated area in comparison to country forest area
        let ratioNew = gladArea * 100 / countryList.area,
            deforestationAreaNew = ratioNew * country.data.area / 100;
        
        // Get map with deforestated area
        let mapper = new Mapper(),
            pixelsAll = await mapper.kilometersToPixels(country.data.area, country),
            pixelsPre = await mapper.kilometersToPixels(deforestationArea, country),
            pixelsNow = await mapper.kilometersToPixels(deforestationAreaNew, country);

        // Avoid painting less than one pixel
        if (pixelsNow < 1) {
            pixelsNow = 1;
        }
        
        // Paint map
        let map = await country.getMapImage();
        map = await mapper.paintArea(map, pixelsAll, this.env.grassColor);
        map = await mapper.paintArea(map, pixelsPre, this.env.deforestatedColorPrevious, this.env.grassColor);
        map = await mapper.paintArea(map, pixelsNow, this.env.deforestatedColor, this.env.grassColor);
        this.console('GENERATED MAP.');
        
        // Write message
        var message = `${gladAreaString} deforestated globally on ${gladDateString}. ${totalAreaString} in total. ${remainingAreaString} remaining in #${countryList.name}. #deforestation`;

        // Country is deforestated
        if (remainingArea < 0) {
            // Move country memory pointer to the next one
            memory.country += 1;
            // Reset aggregated area
            totalArea = 0;

            let countries = this.list.length - memory.country;
            message = `${totalAreaString} deforestated, #${countryList.name} has been deforestated. ${countries} countries remaining. #deforestation`;
        }

        this.console(message);

        let updateError = await this.updateTwitter(map, message);
        if (updateError) {
            this.console('TWITTER ERROR:' + updateError);
            
            return 1;
        } else {
            this.console('TWITTER FEED UPDATED.');
        }
        
        let newMemory = new Memory({
            gladStart: gladDate,
            gladEnd: gladDate,
            gladArea: gladArea,
            country: memory.country,
            area: totalArea,
        });

        await newMemory.save();

        this.console('BOT ROUTINE FINISHED.');
        return 0;
    }
    
    /**
     * Tranform a Date object into a localised string
     * @param {Date} date Date object
     */
    toLocaleDateString(date)
    {
        return new Date(date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    /**
     * Transform an area number into a localised string
     * @param {Number} area 
     */
    toLocaleAreaString(area)
    {
        return Math.round(area).toLocaleString() + 'km²';
    }

    /**
     * Obtain the last memory record
     * @returns {object} Mongoose promise
     */
    getMemory()
    {
        return new Promise((resolve, reject) => {
            let sorting = { sort: { '_id': -1 } };

            Memory.findOne({}, {}, sorting, (error, memory) => {
                if (error) {
                    reject(error);
                }

                if (!memory) {
                    memory = new Memory({
                        gladStart: new Date(),
                        gladEnd: new Date,
                        gladArea: 0,
                        country: 0,
                        area: 0,
                    });

                    memory.save();
                    resolve(memory);
                }

                resolve(memory);
            });
        });
    }
    
    /**
     * Posts to twitter
     * @param {object} map Mapper map object
     * @param {string} message Message to be published
     */
    async updateTwitter(map, message)
    {
        let image = await map.getBufferAsync('image/jpeg'),
            params = {media: image};

        return new Promise((resolve, reject) => {
            if (this.env.twitter.on) {
                this.twitter.post('media/upload', params, (err, data, res) => {
                    if (err) {
                        reject(err);
                    }
        
                    params = {status: message, media_ids: data.media_id_string};
                    this.twitter.post('statuses/update', params, (err, data, res) => {
                        if (err) {
                            reject(err);
                        }
        
                        resolve(false);
                    });
                });
            }
        });
    }
}

module.exports = new Bot;
