from sys import prefix
from ffmpeg import FFmpeg
from pytubefix import YouTube
from pytubefix.cli import on_progress
import os
import time

# Change SAVE_PATH as require !!
SAVE_PATH = "youtube_downloads"
file_extension = ".mp4"
# change 'preferred_resolution' below to your preferred max resolution
preferred_resolution = "1080"
preferred_video_itag = ""
best_resolution_so_far = "0"
audio_only_itag = ""

temp_video_file = os.path.join(SAVE_PATH, "temp.mp4")
temp_video_file_360 = os.path.join(SAVE_PATH, "/temp360.mp4")
temp_audio_file = os.path.join(SAVE_PATH, "temp.m4a")

temp_audio_file1 = os.path.join(SAVE_PATH, "temp-1.mp3")
temp_audio_file2 = os.path.join(SAVE_PATH, "temp-2.mp3")

# ANSI color codes for print console
RED     =   "\033[1;31m"
YELLOW  =   "\033[1;33m"
GREEN   =   "\033[1;32m"
BLUE    =   "\033[1;34m"
CYAN    =   "\033[1;36m"
OFF     =   "\033[0;0m "

def find_best_resolution(yt):
    for stream in yt.fmt_streams:

        global preferred_video_itag
        global best_resolution_so_far
        if stream.resolution and int(stream.resolution[:-1]) > int(best_resolution_so_far):
            preferred_video_itag = stream.itag
            best_resolution_so_far = stream.resolution[:-1]

        if stream.resolution and stream.resolution[:-1] == preferred_resolution:
            preferred_video_itag = stream.itag
            print(f"{GREEN}Using preferred video itag = {preferred_video_itag}{OFF}")
            break

mylist = [
    ]




def read_urls_from_file(filename):
    """Read URLs from a text file"""
    urls = []
    try:
        with open(filename, 'r', encoding='utf-8') as file:
            for line in file:
                url = line.strip()
                if url and not url.startswith('#'):  # Skip empty lines and comments
                    urls.append(url)
                    mylist.append(url)
        return urls
    except FileNotFoundError:
        print(f"Error: File '{filename}' not found.")
        return []
    except Exception as e:
        print(f"Error reading file: {str(e)}")
        return []

def download_youtube_video1(url, output_path='downloads',video_number=1,prefix='v',size=20):
    print(url)
    # preferred_video_itag = ""
    # best_resolution_so_far = "0"
    # audio_only_itag = ""

    try:
        yt = YouTube(url, on_progress_callback = on_progress)
        print(YELLOW + yt.title + OFF)
        # removing unwanted characters in the 'save as' filename (i.e. mainly the forward slash /)
        original_title = "".join(filter(lambda x: x not in "?.!/;:", yt.title))
        yt.title = "temp"


        # Use 'yt.fmt_streams' to find appropriate 'itag' and file_extension
        # VIDEO example: itag='313' ---> res='2160p'  itag='137' ---> res='1080p'
        # Find 'itag' for best resolution in yt.fmt_streams up to 'preferred_video_resolution'
        find_best_resolution(yt)
        video = yt.streams.get_by_itag(preferred_video_itag)
        video.download(output_path=SAVE_PATH)

        video360p = yt.streams.get_by_resolution("360p")
        video.download(output_path=SAVE_PATH,filename=temp_video_file_360)

        # video360p.download(filename=temp_video_file_360)
        


        audio_only_itag = yt.streams.get_audio_only().itag
        audio = yt.streams.get_by_itag(audio_only_itag)
        print(f"{CYAN}Using preferred audio itag = {audio_only_itag}{OFF}")

        audio.download(output_path=SAVE_PATH)


        print("Saving all audios")
        i = 0
        audio_streams = yt.streams.filter( only_audio=True)  
        for stream in audio_streams:
            i = i + 1
            if i>2 :
                break
            print(stream.itag, stream.abr, stream.mime_type)
            # file_name = f"temp- {stream.itag} {stream.abr} - {stream.mime_type} {i}.mp3"
            file_name = f"temp-{i}.mp3"
            print(f"Downloading: {stream.abr} - {stream.mime_type}")
        
            stream.download(output_path=SAVE_PATH,filename=file_name) 
        print("all audios downloaded")


        character_count = min(len(original_title),size)
        video_path = prefix+ str(video_number)+'-'+original_title[:character_count] + file_extension
        print("Saving at -- ",video_path)
        output_file = os.path.join(SAVE_PATH, video_path)

        ffmpeg = (
            FFmpeg()
            .option("y")
            .input(temp_video_file)
            .input(temp_audio_file)
            .output(
                output_file,
                vcodec='copy',
                acodec='aac',
            )
        )
        
        print("Merging video and audio with ffmpeg...")
        ffmpeg.execute()




        video_path = prefix+ str(video_number)+'-'+original_title[:character_count]+'-1' + file_extension
        print("Saving at -- ",video_path)
        output_file = os.path.join(SAVE_PATH, video_path)
        ffmpeg = (
            FFmpeg()
            .option("y")
            .input(temp_video_file)
            .input(temp_audio_file1)
            .output(
                output_file,
                vcodec='copy',
                acodec='aac',
            )
        )
        
        print("Merging video and audio with ffmpeg...")
        ffmpeg.execute()



        video_path = prefix+ str(video_number)+'-'+original_title[:character_count]+'-2' + file_extension
        print("Saving at -- ",video_path)
        output_file = os.path.join(SAVE_PATH, video_path)
        ffmpeg = (
            FFmpeg()
            .option("y")
            .input(temp_video_file)
            .input(temp_audio_file2)
            .output(
                output_file,
                vcodec='copy',
                acodec='aac',
            )
        )
        
        print("Merging video and audio with ffmpeg...")
        ffmpeg.execute()


        # delete temp files after you finish merging video and audio
        os.remove(temp_video_file)
        os.remove(temp_audio_file)
        os.remove(temp_audio_file1)
        os.remove(temp_audio_file2)
    except FileNotFoundError:
        print(RED + "FileNotFoundError" + OFF)
        os.remove(temp_video_file)
        os.remove(temp_audio_file)
        os.remove(temp_audio_file1)
        os.remove(temp_audio_file2)
    except Exception as e:
        if preferred_video_itag == "":
            print(RED + "preferred video itag not found" + OFF)
        elif audio_only_itag == "":
            print(RED + "preferred audio itag not found" + OFF)
        else:
            print(RED + "Some other error" + OFF)
            print(RED + str(e) + OFF)
            os.remove(temp_video_file)
            os.remove(temp_audio_file)    
            os.remove(temp_audio_file1)
            os.remove(temp_audio_file2)



def main(input_file,start=0):
    output_directory = 'youtube_downloads'
    
    print("YouTube Video Downloader")
    print("=" * 50)
    
    # Read URLs from file
    urls = read_urls_from_file(input_file)
    
    if not urls:
        print("No URLs found in the file.")
        return
    
    print(f"Found {len(urls)} URLs in '{input_file}'")
    print("-" * 50)
    
    
    successful_downloads = 0
    failed_downloads = 0
    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] Processing: {url}")
        
        if download_youtube_video1(url, output_directory,start+i,size=20):
            successful_downloads += 1
        else:
            failed_downloads += 1
        
        time.sleep(2)
    
    # Summary
    print("\n" + "=" * 50)
    print("Download Summary:")
    print(f"Total URLs processed: {len(urls)}")
    print(f"Successful downloads: {successful_downloads}")
    print(f"Failed downloads: {failed_downloads}")
    print(f"Videos saved in: {os.path.abspath(output_directory)}")

if __name__ == "__main__":
    # input_file = 'keshav/keshav-6.txt'  # Change this to your file name
    input_file = 'downloads/urls-1.txt' 
    start = 50
    main(input_file,start)

